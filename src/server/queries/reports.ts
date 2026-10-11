/**
 * Report catalog. Every report is computed from the same transactional tables as the
 * dashboard (shipments, receipts, production, ledger, quality), so a posted transaction is
 * reflected here on the next page load. Results are plain serializable data: the client
 * renders charts, a sortable table and CSV export from them.
 */
import type { Sql } from "../db";
import { authorize, type ServiceContext } from "../context";
import { addDays, addMonths, startOfMonth, startOfWeek, type DateRange, type IsoDate } from "@/lib/dates";
import { num } from "@/lib/decimal";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/format";
import { getShortages } from "./dashboard";

export type ReportKey = "revenue" | "otd" | "throughput" | "inventory" | "shortages" | "suppliers" | "wip" | "quality";

export const REPORTS: { key: ReportKey; title: string; category: string; summary: string; definition: string }[] = [
  {
    key: "revenue",
    title: "Revenue & gross margin",
    category: "Sales",
    summary: "Shipped revenue, standard cost of goods sold and margin by period and customer.",
    definition:
      "Revenue is recognized at shipment: shipped quantity × order-line price. COGS is shipped quantity × the standard cost captured on the shipment line. Gross margin % = (revenue − COGS) ÷ revenue. Canceled orders and unshipped quantities are excluded.",
  },
  {
    key: "otd",
    title: "On-time delivery",
    category: "Sales",
    summary: "Share of shipment lines that left on or before the promised date.",
    definition:
      "OTD % = shipment lines with ship date ≤ the order line's promised date ÷ all shipment lines shipped in the period. Each partial shipment counts as its own line. Days late averages only the late lines.",
  },
  {
    key: "throughput",
    title: "Production throughput & yield",
    category: "Production",
    summary: "Good and scrapped units recorded against work orders, with first-pass yield.",
    definition:
      "Good and scrap quantities come from production receipts recorded in the period (by recorded date). Yield % = good ÷ (good + scrap). Value is good units × the work order's estimated unit cost.",
  },
  {
    key: "inventory",
    title: "Inventory value & turns",
    category: "Inventory",
    summary: "On-hand value at standard cost by category, with annualized turns.",
    definition:
      "On-hand value = quantity on hand (all lots, including held and quarantined) × item standard cost. Annualized turns = (COGS shipped + material issued to production in the period, at cost) × 365 ÷ days in period ÷ current on-hand value. Days of supply = 365 ÷ turns.",
  },
  {
    key: "shortages",
    title: "Material shortages",
    category: "Inventory",
    summary: "Items where open work-order and sales demand exceeds usable stock.",
    definition:
      "Demand = unissued work-order material requirements + unshipped sales order quantities, per item and warehouse. Usable = on-hand stock in available, unexpired lots (held, quarantined and expired lots are excluded). Incoming = open PO quantity and work-order output due within 14 days. A shortage is critical when usable + incoming still does not cover demand.",
  },
  {
    key: "suppliers",
    title: "Supplier delivery performance",
    category: "Purchasing",
    summary: "Receipts, on-time %, lead time and purchase-price variance per supplier.",
    definition:
      "Each goods receipt in the period is on time when its receipt date ≤ the PO line's expected date. Lead time = receipt date − PO order date (average across receipts). PPV = (receipt cost − item standard cost) × quantity; positive values are unfavorable.",
  },
  {
    key: "wip",
    title: "Work in process",
    category: "Production",
    summary: "Material value currently sitting on open work orders.",
    definition:
      "For each released, in-progress or on-hold work order: issued material cost (quantity issued × issue cost) minus the material content of units already completed or scrapped (completed + scrapped × quantity per × material cost). Applied labor and overhead are not included in this view.",
  },
  {
    key: "quality",
    title: "Quality incidents",
    category: "Quality",
    summary: "NCRs, complaints and deviations opened by period, severity and source.",
    definition:
      "Counts quality events by the date they were opened. Average days to close covers events closed in the period. Overdue = still open with a due date before today. Severity is the rating assigned by quality at intake.",
  },
];

export function isReportKey(v: unknown): v is ReportKey {
  return REPORTS.some((r) => r.key === v);
}

export type CellFormat = "text" | "currency" | "number" | "percent" | "date";

export interface ReportColumn {
  key: string;
  label: string;
  format?: CellFormat;
  /** Column holding an href for this cell (rendered as a link). */
  hrefKey?: string;
}

export interface ReportChart {
  kind: "column" | "line";
  title: string;
  subtitle?: string;
  format: "currency" | "number" | "percent";
  stacked?: boolean;
  series: { key: string; label: string; color: string }[];
  data: Record<string, string | number | null>[];
}

export interface ReportResult {
  key: ReportKey;
  stats: { label: string; value: string; sub?: string; tone?: "bad" | "good" }[];
  charts: ReportChart[];
  table: { title: string; columns: ReportColumn[]; rows: Record<string, string | number | null>[] };
}

export interface ReportFilters {
  range: DateRange;
  today: IsoDate;
  siteId: string | null;
}

const C1 = "var(--series-1)";
const C2 = "var(--series-2)";
const C3 = "var(--series-3)";
const C4 = "var(--series-4)";
const SITE = `($2::uuid is null or w.site_id = $2::uuid)`;

type Grain = "week" | "month";

/** Weekly buckets for ranges up to ~4 months, monthly beyond that. */
function buckets(range: DateRange): { grain: Grain; keys: IsoDate[]; label: (k: IsoDate) => string } {
  const grain: Grain = range.days <= 120 ? "week" : "month";
  const keys: IsoDate[] = [];
  if (grain === "week") {
    for (let d = startOfWeek(range.from); d <= range.to; d = addDays(d, 7)) keys.push(d);
  } else {
    for (let d = startOfMonth(range.from); d <= range.to; d = addMonths(d, 1)) keys.push(d);
  }
  const label = (k: IsoDate) =>
    grain === "week" ? formatDate(k, { year: false }) : new Date(`${k}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  return { grain, keys, label };
}

const pct = (a: number, b: number) => (b === 0 ? null : (a / b) * 100);
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export async function runReport(db: Sql, ctx: ServiceContext, key: ReportKey, f: ReportFilters): Promise<ReportResult> {
  authorize(ctx, "reports.view");
  switch (key) {
    case "revenue":
      return revenueReport(db, ctx, f);
    case "otd":
      return otdReport(db, ctx, f);
    case "throughput":
      return throughputReport(db, ctx, f);
    case "inventory":
      return inventoryReport(db, ctx, f);
    case "shortages":
      return shortageReport(db, ctx, f);
    case "suppliers":
      return supplierReport(db, ctx, f);
    case "wip":
      return wipReport(db, ctx, f);
    case "quality":
      return qualityReport(db, ctx, f);
  }
}

// ---------------------------------------------------------------------------
async function revenueReport(db: Sql, ctx: ServiceContext, f: ReportFilters): Promise<ReportResult> {
  const b = buckets(f.range);
  const series = await db.query<{ k: string; revenue: string; cogs: string }>(
    `select date_trunc('${b.grain}', sh.ship_date::timestamp)::date::text as k,
            sum(sl.quantity * sl.unit_price) as revenue, sum(sl.quantity * sl.unit_cost) as cogs
     from shipment_lines sl join shipments sh on sh.id = sl.shipment_id join warehouses w on w.id = sh.warehouse_id
     where sh.organization_id = $1 and ${SITE} and sh.ship_date between $3 and $4 group by 1`,
    [ctx.orgId, f.siteId, f.range.from, f.range.to],
  );
  const byKey = new Map(series.map((r) => [r.k, r]));
  const data = b.keys.map((k) => {
    const r = byKey.get(k);
    const revenue = num(r?.revenue ?? 0);
    const cogs = num(r?.cogs ?? 0);
    return { label: b.label(k), revenue: round(revenue), cogs: round(cogs), marginPct: revenue ? round(((revenue - cogs) / revenue) * 100, 1) : null };
  });
  const customers = await db.query<{ id: string; code: string; name: string; orders: number; units: string; revenue: string; cogs: string }>(
    `select c.id, c.code, c.name, count(distinct so.id) as orders, sum(sl.quantity) as units,
            sum(sl.quantity * sl.unit_price) as revenue, sum(sl.quantity * sl.unit_cost) as cogs
     from shipment_lines sl join shipments sh on sh.id = sl.shipment_id join warehouses w on w.id = sh.warehouse_id
     join sales_orders so on so.id = sh.sales_order_id join customers c on c.id = so.customer_id
     where sh.organization_id = $1 and ${SITE} and sh.ship_date between $3 and $4
     group by c.id, c.code, c.name order by revenue desc`,
    [ctx.orgId, f.siteId, f.range.from, f.range.to],
  );
  const revenue = data.reduce((s, d) => s + d.revenue, 0);
  const cogs = data.reduce((s, d) => s + d.cogs, 0);
  return {
    key: "revenue",
    stats: [
      { label: `Shipped revenue · ${f.range.label}`, value: formatCurrency(revenue) },
      { label: "COGS at standard", value: formatCurrency(cogs) },
      { label: "Gross margin", value: formatCurrency(revenue - cogs), sub: formatPercent(pct(revenue - cogs, revenue)) },
      { label: "Customers shipped", value: formatNumber(customers.length) },
    ],
    charts: [
      {
        kind: "column",
        title: `Revenue and COGS by ${b.grain}`,
        subtitle: "Shipped value vs standard cost of shipped units",
        format: "currency",
        series: [
          { key: "revenue", label: "Revenue", color: C1 },
          { key: "cogs", label: "COGS", color: C2 },
        ],
        data,
      },
      {
        kind: "line",
        title: `Gross margin % by ${b.grain}`,
        subtitle: "Periods without shipments are left blank",
        format: "percent",
        series: [{ key: "marginPct", label: "Gross margin %", color: C3 }],
        data,
      },
    ],
    table: {
      title: "Revenue by customer",
      columns: [
        { key: "customer", label: "Customer", hrefKey: "href" },
        { key: "orders", label: "Orders shipped", format: "number" },
        { key: "units", label: "Units", format: "number" },
        { key: "revenue", label: "Revenue", format: "currency" },
        { key: "cogs", label: "COGS", format: "currency" },
        { key: "margin", label: "Margin", format: "currency" },
        { key: "marginPct", label: "Margin %", format: "percent" },
        { key: "share", label: "Share of revenue", format: "percent" },
      ],
      rows: customers.map((c) => {
        const r = num(c.revenue);
        const k = num(c.cogs);
        return {
          customer: `${c.code} · ${c.name}`,
          href: `/sales/orders?customer=${encodeURIComponent(c.name)}`,
          orders: Number(c.orders),
          units: num(c.units),
          revenue: round(r),
          cogs: round(k),
          margin: round(r - k),
          marginPct: pct(r - k, r),
          share: pct(r, revenue),
        };
      }),
    },
  };
}

// ---------------------------------------------------------------------------
async function otdReport(db: Sql, ctx: ServiceContext, f: ReportFilters): Promise<ReportResult> {
  const b = buckets(f.range);
  const rows = await db.query<{ k: string; total: number; on_time: number }>(
    `select date_trunc('${b.grain}', sh.ship_date::timestamp)::date::text as k, count(*) as total,
            count(*) filter (where sh.ship_date <= l.promised_date) as on_time
     from shipment_lines sl join shipments sh on sh.id = sl.shipment_id
     join sales_order_lines l on l.id = sl.sales_order_line_id join warehouses w on w.id = sh.warehouse_id
     where sh.organization_id = $1 and ${SITE} and sh.ship_date between $3 and $4 group by 1`,
    [ctx.orgId, f.siteId, f.range.from, f.range.to],
  );
  const byKey = new Map(rows.map((r) => [r.k, r]));
  const data = b.keys.map((k) => {
    const r = byKey.get(k);
    const total = Number(r?.total ?? 0);
    const onTime = Number(r?.on_time ?? 0);
    return { label: b.label(k), otd: total ? round((onTime / total) * 100, 1) : null, onTime, late: total - onTime };
  });
  const customers = await db.query<{ code: string; name: string; total: number; on_time: number; late_days: string | null }>(
    `select c.code, c.name, count(*) as total, count(*) filter (where sh.ship_date <= l.promised_date) as on_time,
            avg(sh.ship_date - l.promised_date) filter (where sh.ship_date > l.promised_date) as late_days
     from shipment_lines sl join shipments sh on sh.id = sl.shipment_id
     join sales_order_lines l on l.id = sl.sales_order_line_id join sales_orders so on so.id = l.sales_order_id
     join customers c on c.id = so.customer_id join warehouses w on w.id = sh.warehouse_id
     where sh.organization_id = $1 and ${SITE} and sh.ship_date between $3 and $4
     group by c.code, c.name order by (count(*) filter (where sh.ship_date <= l.promised_date))::numeric / count(*) asc, c.code`,
    [ctx.orgId, f.siteId, f.range.from, f.range.to],
  );
  const total = data.reduce((s, d) => s + d.onTime + d.late, 0);
  const onTime = data.reduce((s, d) => s + d.onTime, 0);
  const lateAvg = customers.reduce((s, c) => s + num(c.late_days ?? 0) * (Number(c.total) - Number(c.on_time)), 0) / Math.max(1, total - onTime);
  return {
    key: "otd",
    stats: [
      { label: `On-time delivery · ${f.range.label}`, value: formatPercent(pct(onTime, total)), tone: (pct(onTime, total) ?? 100) < 90 ? "bad" : undefined },
      { label: "Shipment lines", value: formatNumber(total) },
      { label: "Late lines", value: formatNumber(total - onTime) },
      { label: "Average days late", value: total - onTime ? formatNumber(lateAvg, 1) : "—", sub: "Late lines only" },
    ],
    charts: [
      {
        kind: "line",
        title: `On-time delivery % by ${b.grain}`,
        subtitle: "Shipment lines shipped on or before the promised date",
        format: "percent",
        series: [{ key: "otd", label: "On-time %", color: C1 }],
        data,
      },
      {
        kind: "column",
        title: `Shipment lines by ${b.grain}`,
        subtitle: "On-time and late lines",
        format: "number",
        stacked: true,
        series: [
          { key: "onTime", label: "On time", color: C1 },
          { key: "late", label: "Late", color: C2 },
        ],
        data,
      },
    ],
    table: {
      title: "On-time delivery by customer",
      columns: [
        { key: "customer", label: "Customer" },
        { key: "lines", label: "Lines shipped", format: "number" },
        { key: "onTime", label: "On time", format: "number" },
        { key: "late", label: "Late", format: "number" },
        { key: "otd", label: "OTD %", format: "percent" },
        { key: "lateDays", label: "Avg days late", format: "number" },
      ],
      rows: customers.map((c) => ({
        customer: `${c.code} · ${c.name}`,
        lines: Number(c.total),
        onTime: Number(c.on_time),
        late: Number(c.total) - Number(c.on_time),
        otd: pct(Number(c.on_time), Number(c.total)),
        lateDays: c.late_days === null ? null : round(num(c.late_days), 1),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
async function throughputReport(db: Sql, ctx: ServiceContext, f: ReportFilters): Promise<ReportResult> {
  const b = buckets(f.range);
  const rows = await db.query<{ k: string; good: string; scrap: string }>(
    `select date_trunc('${b.grain}', (pr.recorded_at at time zone $5)::date::timestamp)::date::text as k,
            sum(pr.quantity_good) as good, sum(pr.quantity_scrap) as scrap
     from production_receipts pr join work_orders wo on wo.id = pr.work_order_id join warehouses w on w.id = wo.warehouse_id
     where pr.organization_id = $1 and ${SITE} and (pr.recorded_at at time zone $5)::date between $3 and $4 group by 1`,
    [ctx.orgId, f.siteId, f.range.from, f.range.to, ctx.timezone],
  );
  const byKey = new Map(rows.map((r) => [r.k, r]));
  const data = b.keys.map((k) => {
    const r = byKey.get(k);
    const good = num(r?.good ?? 0);
    const scrap = num(r?.scrap ?? 0);
    return { label: b.label(k), good, scrap, yield: good + scrap ? round((good / (good + scrap)) * 100, 1) : null };
  });
  const items = await db.query<{ id: string; sku: string; name: string; family: string | null; wos: number; good: string; scrap: string; value: string }>(
    `select i.id, i.sku, i.name, i.product_family as family, count(distinct wo.id) as wos,
            sum(pr.quantity_good) as good, sum(pr.quantity_scrap) as scrap, sum(pr.quantity_good * wo.estimated_unit_cost) as value
     from production_receipts pr join work_orders wo on wo.id = pr.work_order_id join items i on i.id = wo.item_id
     join warehouses w on w.id = wo.warehouse_id
     where pr.organization_id = $1 and ${SITE} and (pr.recorded_at at time zone $5)::date between $3 and $4
     group by i.id, i.sku, i.name, i.product_family order by sum(pr.quantity_good) desc`,
    [ctx.orgId, f.siteId, f.range.from, f.range.to, ctx.timezone],
  );
  const good = data.reduce((s, d) => s + d.good, 0);
  const scrap = data.reduce((s, d) => s + d.scrap, 0);
  const value = items.reduce((s, i) => s + num(i.value), 0);
  return {
    key: "throughput",
    stats: [
      { label: `Good units · ${f.range.label}`, value: formatNumber(good, 0) },
      { label: "Scrapped units", value: formatNumber(scrap, 0) },
      { label: "Yield", value: formatPercent(pct(good, good + scrap)), tone: (pct(good, good + scrap) ?? 100) < 95 ? "bad" : undefined },
      { label: "Output value at standard", value: formatCurrency(value) },
    ],
    charts: [
      {
        kind: "column",
        title: `Units produced by ${b.grain}`,
        subtitle: "Good and scrapped units from production receipts",
        format: "number",
        stacked: true,
        series: [
          { key: "good", label: "Good", color: C1 },
          { key: "scrap", label: "Scrap", color: C2 },
        ],
        data,
      },
      {
        kind: "line",
        title: `Yield % by ${b.grain}`,
        format: "percent",
        series: [{ key: "yield", label: "Yield %", color: C3 }],
        data,
      },
    ],
    table: {
      title: "Throughput by item",
      columns: [
        { key: "item", label: "Item", hrefKey: "href" },
        { key: "family", label: "Family" },
        { key: "wos", label: "Work orders", format: "number" },
        { key: "good", label: "Good", format: "number" },
        { key: "scrap", label: "Scrap", format: "number" },
        { key: "yield", label: "Yield %", format: "percent" },
        { key: "value", label: "Value", format: "currency" },
      ],
      rows: items.map((i) => ({
        item: `${i.sku} · ${i.name}`,
        href: `/inventory/items/${i.id}`,
        family: i.family ?? "—",
        wos: Number(i.wos),
        good: num(i.good),
        scrap: num(i.scrap),
        yield: pct(num(i.good), num(i.good) + num(i.scrap)),
        value: round(num(i.value)),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
async function inventoryReport(db: Sql, ctx: ServiceContext, f: ReportFilters): Promise<ReportResult> {
  const items = await db.query<{ id: string; sku: string; name: string; category: string; item_type: string; qty: string; value: string; consumed: string; held: string }>(
    `with onhand as (
       select b.item_id, sum(b.qty_on_hand) as qty,
              sum(b.qty_on_hand) filter (where l.status in ('hold','quarantine')) as held
       from inventory_balances b join warehouses w on w.id = b.warehouse_id left join inventory_lots l on l.id = b.lot_id
       where b.organization_id = $1 and ${SITE} group by 1
     ), used as (
       select m.item_id, sum(-m.quantity * m.unit_cost) as v
       from inventory_movements m join warehouses w on w.id = m.warehouse_id
       where m.organization_id = $1 and ${SITE} and m.movement_type in ('shipment','issue','scrap')
         and (m.occurred_at at time zone $5)::date between $3 and $4 group by 1
     )
     select i.id, i.sku, i.name, i.category, i.item_type, coalesce(o.qty, 0) as qty, coalesce(o.qty, 0) * i.standard_cost as value,
            coalesce(u.v, 0) as consumed, coalesce(o.held, 0) as held
     from items i left join onhand o on o.item_id = i.id left join used u on u.item_id = i.id
     where i.organization_id = $1 and (o.qty > 0 or u.v > 0)
     order by coalesce(o.qty, 0) * i.standard_cost desc`,
    [ctx.orgId, f.siteId, f.range.from, f.range.to, ctx.timezone],
  );
  const annualize = 365 / f.range.days;
  const byCat = new Map<string, { value: number; consumed: number }>();
  for (const i of items) {
    const cat = i.category;
    const c = byCat.get(cat) ?? { value: 0, consumed: 0 };
    c.value += num(i.value);
    c.consumed += num(i.consumed);
    byCat.set(cat, c);
  }
  const value = items.reduce((s, i) => s + num(i.value), 0);
  const consumed = items.reduce((s, i) => s + num(i.consumed), 0);
  const turns = value ? (consumed * annualize) / value : null;
  const held = items.reduce((s, i) => s + num(i.held) * (num(i.qty) ? num(i.value) / num(i.qty) : 0), 0);
  // Top seven categories by value; the rest fold into "Other" so labels stay readable.
  const sortedCats = [...byCat.entries()].sort((a, b) => b[1].value - a[1].value);
  const folded = sortedCats.slice(0, 7);
  if (sortedCats.length > 7) {
    const other = sortedCats.slice(7).reduce((acc, [, c]) => ({ value: acc.value + c.value, consumed: acc.consumed + c.consumed }), { value: 0, consumed: 0 });
    folded.push(["Other", other]);
  }
  const catData = folded.map(([cat, c]) => ({ label: cat, value: round(c.value), turns: c.value ? round((c.consumed * annualize) / c.value, 1) : 0 }));
  return {
    key: "inventory",
    stats: [
      { label: "On-hand value at standard", value: formatCurrency(value) },
      { label: `Annualized turns · ${f.range.label}`, value: turns === null ? "—" : formatNumber(turns, 1) },
      { label: "Days of supply", value: turns ? formatNumber(365 / turns, 0) : "—" },
      { label: "Value on hold or quarantine", value: formatCurrency(held), tone: held > 0 ? "bad" : undefined },
    ],
    charts: [
      {
        kind: "column",
        title: "On-hand value by category",
        subtitle: "Quantity on hand × standard cost",
        format: "currency",
        series: [{ key: "value", label: "On-hand value", color: C1 }],
        data: catData,
      },
      {
        kind: "column",
        title: "Annualized turns by category",
        subtitle: "Consumption at cost × 365 ÷ days ÷ on-hand value",
        format: "number",
        series: [{ key: "turns", label: "Turns", color: C3 }],
        data: catData,
      },
    ],
    table: {
      title: "Inventory by item",
      columns: [
        { key: "item", label: "Item", hrefKey: "href" },
        { key: "category", label: "Category" },
        { key: "type", label: "Type" },
        { key: "qty", label: "On hand", format: "number" },
        { key: "value", label: "Value", format: "currency" },
        { key: "consumed", label: "Consumed in period", format: "currency" },
        { key: "turns", label: "Turns", format: "number" },
        { key: "dos", label: "Days of supply", format: "number" },
      ],
      rows: items.map((i) => {
        const v = num(i.value);
        const t = v ? (num(i.consumed) * annualize) / v : null;
        return {
          item: `${i.sku} · ${i.name}`,
          href: `/inventory/items/${i.id}`,
          category: i.category,
          type: i.item_type === "manufactured" ? "Manufactured" : "Purchased",
          qty: num(i.qty),
          value: round(v),
          consumed: round(num(i.consumed)),
          turns: t === null ? null : round(t, 1),
          dos: t ? Math.round(365 / t) : null,
        };
      }),
    },
  };
}

// ---------------------------------------------------------------------------
async function shortageReport(db: Sql, ctx: ServiceContext, f: ReportFilters): Promise<ReportResult> {
  const rows = await getShortages(db, ctx, { siteId: f.siteId, today: f.today, family: null });
  const critical = rows.filter((r) => r.critical);
  const top = rows.slice(0, 12);
  return {
    key: "shortages",
    stats: [
      { label: "Items short", value: formatNumber(rows.length), tone: rows.length ? "bad" : "good" },
      { label: "Critical (not covered by incoming)", value: formatNumber(critical.length), tone: critical.length ? "bad" : "good" },
      { label: "Earliest need date", value: rows.length ? formatDate(rows.map((r) => r.needDate ?? "9999").sort()[0]) : "—" },
      { label: "Units short", value: formatNumber(rows.reduce((s, r) => s - r.net, 0), 0) },
    ],
    charts: [
      {
        kind: "column",
        title: "Largest gaps: demand vs usable stock",
        subtitle: "Top 12 by uncovered quantity",
        format: "number",
        series: [
          { key: "demand", label: "Demand", color: C1 },
          { key: "usable", label: "Usable", color: C2 },
          { key: "incoming", label: "Incoming ≤14d", color: C3 },
        ],
        data: top.map((r) => ({ label: r.sku, demand: r.demand, usable: r.usable, incoming: r.incoming })),
      },
    ],
    table: {
      title: "Shortage list",
      columns: [
        { key: "item", label: "Item", hrefKey: "href" },
        { key: "warehouse", label: "Warehouse" },
        { key: "demand", label: "Demand", format: "number" },
        { key: "usable", label: "Usable", format: "number" },
        { key: "net", label: "Net", format: "number" },
        { key: "incoming", label: "Incoming ≤14d", format: "number" },
        { key: "needDate", label: "Need date", format: "date" },
        { key: "status", label: "Status" },
      ],
      rows: rows.map((r) => ({
        item: `${r.sku} · ${r.name}`,
        href: `/inventory/items/${r.itemId}`,
        warehouse: r.warehouseCode,
        demand: r.demand,
        usable: r.usable,
        net: r.net,
        incoming: r.incoming,
        needDate: r.needDate,
        status: r.critical ? "Critical" : "Covered by incoming",
      })),
    },
  };
}

// ---------------------------------------------------------------------------
async function supplierReport(db: Sql, ctx: ServiceContext, f: ReportFilters): Promise<ReportResult> {
  const rows = await db.query<{ id: string; code: string; name: string; receipts: number; on_time: number; lead: string; value: string; ppv: string; ncrs: number }>(
    `select s.id, s.code, s.name, count(gr.id) as receipts,
            count(gr.id) filter (where (gr.received_at at time zone $5)::date <= pol.expected_date) as on_time,
            avg((gr.received_at at time zone $5)::date - po.order_date) as lead,
            sum(gr.quantity * gr.unit_cost) as value,
            sum(gr.quantity * (gr.unit_cost - i.standard_cost)) as ppv,
            (select count(*) from quality_events q where q.supplier_id = s.id and (q.opened_at at time zone $5)::date between $3 and $4) as ncrs
     from goods_receipts gr join purchase_order_lines pol on pol.id = gr.purchase_order_line_id
     join purchase_orders po on po.id = gr.purchase_order_id join suppliers s on s.id = po.supplier_id
     join items i on i.id = gr.item_id join warehouses w on w.id = gr.warehouse_id
     where gr.organization_id = $1 and ${SITE} and (gr.received_at at time zone $5)::date between $3 and $4
     group by s.id, s.code, s.name order by sum(gr.quantity * gr.unit_cost) desc`,
    [ctx.orgId, f.siteId, f.range.from, f.range.to, ctx.timezone],
  );
  const receipts = rows.reduce((s, r) => s + Number(r.receipts), 0);
  const onTime = rows.reduce((s, r) => s + Number(r.on_time), 0);
  const spend = rows.reduce((s, r) => s + num(r.value), 0);
  const ppv = rows.reduce((s, r) => s + num(r.ppv), 0);
  const chartRows = rows.map((r) => ({ label: r.code, onTime: round(pct(Number(r.on_time), Number(r.receipts)) ?? 0, 1), lead: round(num(r.lead), 1) }));
  return {
    key: "suppliers",
    stats: [
      { label: `Receipts · ${f.range.label}`, value: formatNumber(receipts) },
      { label: "On-time receipts", value: formatPercent(pct(onTime, receipts)), tone: (pct(onTime, receipts) ?? 100) < 85 ? "bad" : undefined },
      { label: "Received value", value: formatCurrency(spend) },
      { label: "Purchase price variance", value: formatCurrency(ppv), sub: ppv > 0 ? "Unfavorable" : "Favorable", tone: ppv > 0 ? "bad" : "good" },
    ],
    charts: [
      {
        kind: "column",
        title: "On-time receipt % by supplier",
        format: "percent",
        series: [{ key: "onTime", label: "On-time %", color: C1 }],
        data: chartRows,
      },
      {
        kind: "column",
        title: "Average lead time by supplier",
        subtitle: "Days from PO date to receipt",
        format: "number",
        series: [{ key: "lead", label: "Lead time (days)", color: C4 }],
        data: chartRows,
      },
    ],
    table: {
      title: "Supplier scorecard",
      columns: [
        { key: "supplier", label: "Supplier", hrefKey: "href" },
        { key: "receipts", label: "Receipts", format: "number" },
        { key: "onTime", label: "On-time %", format: "percent" },
        { key: "lead", label: "Avg lead (days)", format: "number" },
        { key: "value", label: "Received value", format: "currency" },
        { key: "ppv", label: "PPV", format: "currency" },
        { key: "ncrs", label: "Quality events", format: "number" },
      ],
      rows: rows.map((r) => ({
        supplier: `${r.code} · ${r.name}`,
        href: `/purchasing?supplier=${encodeURIComponent(r.name)}`,
        receipts: Number(r.receipts),
        onTime: pct(Number(r.on_time), Number(r.receipts)),
        lead: round(num(r.lead), 1),
        value: round(num(r.value)),
        ppv: round(num(r.ppv)),
        ncrs: Number(r.ncrs),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
async function wipReport(db: Sql, ctx: ServiceContext, f: ReportFilters): Promise<ReportResult> {
  const rows = await db.query<{ id: string; wo_number: string; sku: string; status: string; wc: string | null; due_date: string; planned: string; done: string; issued: string; consumed: string }>(
    `select wo.id, wo.wo_number, i.sku, wo.status, wc.code as wc, wo.due_date::text, wo.quantity_planned as planned,
            wo.quantity_completed + wo.quantity_scrapped as done,
            coalesce((select sum(mi.quantity * mi.unit_cost) from material_issues mi where mi.work_order_id = wo.id), 0) as issued,
            coalesce((select sum(m.quantity_per * m.unit_cost) from work_order_materials m where m.work_order_id = wo.id), 0)
              * (wo.quantity_completed + wo.quantity_scrapped) as consumed
     from work_orders wo join items i on i.id = wo.item_id join warehouses w on w.id = wo.warehouse_id
     left join work_centers wc on wc.id = wo.work_center_id
     where wo.organization_id = $1 and ${SITE} and wo.status in ('released','in_progress','on_hold')
     order by wo.due_date, wo.wo_number`,
    [ctx.orgId, f.siteId],
  );
  const mapped = rows.map((r) => {
    const wip = Math.max(0, num(r.issued) - num(r.consumed));
    return { ...r, wip, late: r.due_date < f.today };
  });
  const byStatus = new Map<string, number>();
  const byWc = new Map<string, number>();
  for (const r of mapped) {
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + r.wip);
    byWc.set(r.wc ?? "Unassigned", (byWc.get(r.wc ?? "Unassigned") ?? 0) + r.wip);
  }
  const total = mapped.reduce((s, r) => s + r.wip, 0);
  const lateWip = mapped.filter((r) => r.late).reduce((s, r) => s + r.wip, 0);
  const statusLabel: Record<string, string> = { released: "Released", in_progress: "In progress", on_hold: "On hold" };
  return {
    key: "wip",
    stats: [
      { label: "WIP material value", value: formatCurrency(total) },
      { label: "Open work orders", value: formatNumber(mapped.length) },
      { label: "With materials issued", value: formatNumber(mapped.filter((r) => num(r.issued) > 0).length) },
      { label: "WIP on late orders", value: formatCurrency(lateWip), tone: lateWip > 0 ? "bad" : undefined },
    ],
    charts: [
      {
        kind: "column",
        title: "WIP value by work center",
        format: "currency",
        series: [{ key: "value", label: "WIP value", color: C1 }],
        data: [...byWc.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value: round(value) })),
      },
      {
        kind: "column",
        title: "WIP value by status",
        format: "currency",
        series: [{ key: "value", label: "WIP value", color: C4 }],
        data: ["released", "in_progress", "on_hold"].map((s) => ({ label: statusLabel[s], value: round(byStatus.get(s) ?? 0) })),
      },
    ],
    table: {
      title: "Open work orders",
      columns: [
        { key: "wo", label: "Work order", hrefKey: "href" },
        { key: "item", label: "Item" },
        { key: "status", label: "Status" },
        { key: "workCenter", label: "Work center" },
        { key: "due", label: "Due", format: "date" },
        { key: "progress", label: "Done / planned" },
        { key: "issued", label: "Material issued", format: "currency" },
        { key: "wip", label: "WIP value", format: "currency" },
      ],
      rows: mapped.map((r) => ({
        wo: r.wo_number,
        href: `/production/work-orders/${r.id}`,
        item: r.sku,
        status: (statusLabel[r.status] ?? r.status) + (r.late ? " · late" : ""),
        workCenter: r.wc ?? "—",
        due: r.due_date,
        progress: `${formatNumber(r.done, 0)} / ${formatNumber(r.planned, 0)}`,
        issued: round(num(r.issued)),
        wip: round(r.wip),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
async function qualityReport(db: Sql, ctx: ServiceContext, f: ReportFilters): Promise<ReportResult> {
  const b = buckets(f.range);
  const events = await db.query<{ k: string; severity: string; n: number }>(
    `select date_trunc('${b.grain}', (q.opened_at at time zone $5)::date::timestamp)::date::text as k, q.severity, count(*) as n
     from quality_events q
     where q.organization_id = $1 and ($2::uuid is null or q.site_id is null or q.site_id = $2::uuid)
       and (q.opened_at at time zone $5)::date between $3 and $4 group by 1, 2`,
    [ctx.orgId, f.siteId, f.range.from, f.range.to, ctx.timezone],
  );
  const data = b.keys.map((k) => {
    const row: Record<string, string | number> = { label: b.label(k), low: 0, medium: 0, high: 0, critical: 0 };
    for (const e of events) if (e.k === k) row[e.severity] = Number(e.n);
    return row;
  });
  const groups = await db.query<{ event_type: string; source: string; opened: number; open_now: number; overdue: number; closed: number; days_to_close: string | null }>(
    `select q.event_type, q.source, count(*) as opened,
            count(*) filter (where q.status in ('open','investigating','pending_disposition')) as open_now,
            count(*) filter (where q.status in ('open','investigating','pending_disposition') and q.due_date < $6::date) as overdue,
            count(*) filter (where q.closed_at is not null) as closed,
            avg(extract(epoch from (q.closed_at - q.opened_at)) / 86400) filter (where q.closed_at is not null) as days_to_close
     from quality_events q
     where q.organization_id = $1 and ($2::uuid is null or q.site_id is null or q.site_id = $2::uuid)
       and (q.opened_at at time zone $5)::date between $3 and $4
     group by 1, 2 order by count(*) desc`,
    [ctx.orgId, f.siteId, f.range.from, f.range.to, ctx.timezone, f.today],
  );
  const opened = groups.reduce((s, g) => s + Number(g.opened), 0);
  const overdue = groups.reduce((s, g) => s + Number(g.overdue), 0);
  const closedRows = groups.filter((g) => g.days_to_close !== null);
  const closed = closedRows.reduce((s, g) => s + Number(g.closed), 0);
  const avgClose = closed ? closedRows.reduce((s, g) => s + num(g.days_to_close!) * Number(g.closed), 0) / closed : null;
  const critical = events.filter((e) => e.severity === "critical" || e.severity === "high").reduce((s, e) => s + Number(e.n), 0);
  const typeLabel: Record<string, string> = { ncr: "NCR", complaint: "Customer complaint", deviation: "Deviation", audit_finding: "Audit finding" };
  const sourceLabel: Record<string, string> = { incoming: "Incoming", in_process: "In-process", final: "Final", customer: "Customer", internal: "Internal" };
  return {
    key: "quality",
    stats: [
      { label: `Events opened · ${f.range.label}`, value: formatNumber(opened) },
      { label: "High or critical", value: formatNumber(critical), tone: critical ? "bad" : undefined },
      { label: "Overdue (still open)", value: formatNumber(overdue), tone: overdue ? "bad" : "good" },
      { label: "Average days to close", value: avgClose === null ? "—" : formatNumber(avgClose, 1) },
    ],
    charts: [
      {
        kind: "column",
        title: `Events opened by ${b.grain} and severity`,
        format: "number",
        stacked: true,
        series: [
          // Severity is ordinal, so it gets one hue stepped light → dark rather than categorical hues.
          { key: "low", label: "Low", color: "color-mix(in oklab, var(--series-2) 30%, var(--chart-surface))" },
          { key: "medium", label: "Medium", color: "color-mix(in oklab, var(--series-2) 55%, var(--chart-surface))" },
          { key: "high", label: "High", color: "color-mix(in oklab, var(--series-2) 80%, var(--chart-surface))" },
          { key: "critical", label: "Critical", color: "var(--series-2)" },
        ],
        data,
      },
    ],
    table: {
      title: "Events by type and source",
      columns: [
        { key: "type", label: "Type" },
        { key: "source", label: "Source" },
        { key: "opened", label: "Opened", format: "number" },
        { key: "openNow", label: "Still open", format: "number" },
        { key: "overdue", label: "Overdue", format: "number" },
        { key: "closed", label: "Closed", format: "number" },
        { key: "daysToClose", label: "Avg days to close", format: "number" },
      ],
      rows: groups.map((g) => ({
        type: typeLabel[g.event_type] ?? g.event_type,
        source: sourceLabel[g.source] ?? g.source,
        opened: Number(g.opened),
        openNow: Number(g.open_now),
        overdue: Number(g.overdue),
        closed: Number(g.closed),
        daysToClose: g.days_to_close === null ? null : round(num(g.days_to_close), 1),
      })),
    },
  };
}

