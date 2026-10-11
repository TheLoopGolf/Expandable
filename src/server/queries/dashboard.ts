import type { Sql } from "../db";
import { authorize, type ServiceContext } from "../context";
import { addDays, addMonths, diffDays, startOfMonth, startOfWeek, type DateRange, type IsoDate } from "@/lib/dates";
import { num } from "@/lib/decimal";
import { formatDate } from "@/lib/format";

export interface DashboardFilters {
  range: DateRange;
  today: IsoDate;
  siteId: string | null;
  family: string | null;
}

export interface Kpi {
  key: string;
  label: string;
  value: number;
  format: "currency" | "percent" | "number";
  previous: number | null;
  previousLabel: string | null;
  /** Whether an increase is good (drives delta color). */
  higherIsBetter: boolean;
  definition: string;
  href: string;
  spark?: number[];
}

const siteWh = `($2::uuid is null or w.site_id = $2::uuid)`;
const famItem = `($3::text is null or i.product_family = $3::text)`;

function params(ctx: ServiceContext, f: DashboardFilters, ...rest: unknown[]) {
  return [ctx.orgId, f.siteId, f.family, ...rest];
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------
async function revenueBetween(db: Sql, ctx: ServiceContext, f: DashboardFilters, from: IsoDate, to: IsoDate) {
  const [row] = await db.query<{ v: string }>(
    `select coalesce(sum(sl.quantity * sl.unit_price), 0) as v
     from shipment_lines sl join shipments sh on sh.id = sl.shipment_id
     join warehouses w on w.id = sh.warehouse_id join items i on i.id = sl.item_id
     where sh.organization_id = $1 and ${siteWh} and ${famItem} and sh.ship_date between $4 and $5`,
    params(ctx, f, from, to),
  );
  return num(row.v);
}

async function openOrderValueAt(db: Sql, ctx: ServiceContext, f: DashboardFilters, asOf: IsoDate | null) {
  if (asOf === null) {
    const [row] = await db.query<{ v: string }>(
      `select coalesce(sum((l.quantity_ordered - l.quantity_shipped) * l.unit_price), 0) as v
       from sales_order_lines l join sales_orders so on so.id = l.sales_order_id
       join warehouses w on w.id = so.warehouse_id join items i on i.id = l.item_id
       where so.organization_id = $1 and ${siteWh} and ${famItem} and so.status in ('confirmed','partially_shipped','on_hold')`,
      params(ctx, f),
    );
    return num(row.v);
  }
  // Reconstruct the backlog at the end of a past day from confirmations, cancellations and shipments.
  const [row] = await db.query<{ v: string }>(
    `select coalesce(sum(greatest(l.quantity_ordered - coalesce(shipped.q, 0), 0) * l.unit_price), 0) as v
     from sales_order_lines l join sales_orders so on so.id = l.sales_order_id
     join warehouses w on w.id = so.warehouse_id join items i on i.id = l.item_id
     left join lateral (
       select sum(sl.quantity) as q from shipment_lines sl join shipments sh on sh.id = sl.shipment_id
       where sl.sales_order_line_id = l.id and sh.ship_date <= $4::date) shipped on true
     where so.organization_id = $1 and ${siteWh} and ${famItem}
       and so.confirmed_at is not null and so.order_date <= $4::date
       and (so.canceled_at is null or so.canceled_at::date > $4::date)
       and (so.closed_at is null or so.closed_at::date > $4::date)`,
    params(ctx, f, asOf),
  );
  return num(row.v);
}

async function otdBetween(db: Sql, ctx: ServiceContext, f: DashboardFilters, from: IsoDate, to: IsoDate) {
  const [row] = await db.query<{ total: number; on_time: number }>(
    `select count(*) as total, count(*) filter (where sh.ship_date <= l.promised_date) as on_time
     from shipment_lines sl join shipments sh on sh.id = sl.shipment_id
     join sales_order_lines l on l.id = sl.sales_order_line_id
     join warehouses w on w.id = sh.warehouse_id join items i on i.id = sl.item_id
     where sh.organization_id = $1 and ${siteWh} and ${famItem} and sh.ship_date between $4 and $5`,
    params(ctx, f, from, to),
  );
  const total = Number(row.total);
  return total === 0 ? null : (Number(row.on_time) / total) * 100;
}

async function inventoryValueAt(db: Sql, ctx: ServiceContext, f: DashboardFilters, asOf: IsoDate | null) {
  const [row] = asOf
    ? await db.query<{ v: string }>(
        `select coalesce(sum(m.quantity * i.standard_cost), 0) as v
         from inventory_movements m join warehouses w on w.id = m.warehouse_id join items i on i.id = m.item_id
         where m.organization_id = $1 and ${siteWh} and ${famItem}
           and (m.occurred_at at time zone $5)::date <= $4::date`,
        params(ctx, f, asOf, ctx.timezone),
      )
    : await db.query<{ v: string }>(
        `select coalesce(sum(b.qty_on_hand * i.standard_cost), 0) as v
         from inventory_balances b join warehouses w on w.id = b.warehouse_id join items i on i.id = b.item_id
         where b.organization_id = $1 and ${siteWh} and ${famItem}`,
        params(ctx, f),
      );
  return num(row.v);
}

async function openQualityAt(db: Sql, ctx: ServiceContext, f: DashboardFilters, asOf: IsoDate | null) {
  const [row] = asOf
    ? await db.query<{ n: number }>(
        `select count(*) as n from quality_events q
         where q.organization_id = $1 and ($2::uuid is null or q.site_id is null or q.site_id = $2::uuid) and ($3::text is null or exists (select 1 from items i where i.id = q.item_id and i.product_family = $3::text))
           and (q.opened_at at time zone $5)::date <= $4::date
           and (q.closed_at is null or (q.closed_at at time zone $5)::date > $4::date)`,
        params(ctx, f, asOf, ctx.timezone),
      )
    : await db.query<{ n: number }>(
        `select count(*) as n from quality_events q
         where q.organization_id = $1 and ($2::uuid is null or q.site_id is null or q.site_id = $2::uuid) and ($3::text is null or exists (select 1 from items i where i.id = q.item_id and i.product_family = $3::text))
           and q.status in ('open','investigating','pending_disposition')`,
        params(ctx, f),
      );
  return Number(row.n);
}

async function workOrdersOnSchedule(db: Sql, ctx: ServiceContext, f: DashboardFilters) {
  const [row] = await db.query<{ total: number; on_schedule: number }>(
    `select count(*) as total,
            count(*) filter (where wo.status <> 'on_hold' and wo.due_date >= $4::date) as on_schedule
     from work_orders wo join warehouses w on w.id = wo.warehouse_id join items i on i.id = wo.item_id
     where wo.organization_id = $1 and ${siteWh} and ${famItem} and wo.status in ('released','in_progress','on_hold')`,
    params(ctx, f, f.today),
  );
  const total = Number(row.total);
  return { pct: total === 0 ? 100 : (Number(row.on_schedule) / total) * 100, total, onSchedule: Number(row.on_schedule) };
}

async function weeklyRevenueSpark(db: Sql, ctx: ServiceContext, f: DashboardFilters) {
  const start = startOfWeek(addDays(f.today, -7 * 11));
  const rows = await db.query<{ wk: string; v: string }>(
    `select date_trunc('week', sh.ship_date::timestamp)::date::text as wk, sum(sl.quantity * sl.unit_price) as v
     from shipment_lines sl join shipments sh on sh.id = sl.shipment_id
     join warehouses w on w.id = sh.warehouse_id join items i on i.id = sl.item_id
     where sh.organization_id = $1 and ${siteWh} and ${famItem} and sh.ship_date >= $4 group by 1`,
    params(ctx, f, start),
  );
  const byWeek = new Map(rows.map((r) => [r.wk, num(r.v)]));
  return Array.from({ length: 12 }, (_, i) => byWeek.get(addDays(start, i * 7)) ?? 0);
}

export async function getKpis(db: Sql, ctx: ServiceContext, f: DashboardFilters): Promise<Kpi[]> {
  authorize(ctx, "dashboard.view");
  const mtdFrom = startOfMonth(f.today);
  const prevMtdFrom = addMonths(mtdFrom, -1);
  const prevMtdTo = addMonths(f.today, -1);
  const monthAgo = addDays(f.today, -30);
  const [revenue, revenuePrev, openValue, openValuePrev, otd, otdPrev, invValue, invValuePrev, quality, qualityPrev, wos, shortages, spark] =
    await Promise.all([
      revenueBetween(db, ctx, f, mtdFrom, f.today),
      revenueBetween(db, ctx, f, prevMtdFrom, prevMtdTo),
      openOrderValueAt(db, ctx, f, null),
      openOrderValueAt(db, ctx, f, monthAgo),
      otdBetween(db, ctx, f, f.range.from, f.range.to),
      otdBetween(db, ctx, f, f.range.prevFrom, f.range.prevTo),
      inventoryValueAt(db, ctx, f, null),
      inventoryValueAt(db, ctx, f, monthAgo),
      openQualityAt(db, ctx, f, null),
      openQualityAt(db, ctx, f, monthAgo),
      workOrdersOnSchedule(db, ctx, f),
      getShortages(db, ctx, f),
      weeklyRevenueSpark(db, ctx, f),
    ]);
  const critical = new Set(shortages.filter((s) => s.critical).map((s) => s.itemId)).size;
  return [
    {
      key: "revenue",
      label: "Revenue MTD",
      value: revenue,
      format: "currency",
      previous: revenuePrev,
      previousLabel: `vs ${formatDate(prevMtdFrom, { year: false })}–${formatDate(prevMtdTo, { year: false }).replace(/^\w+ /, "")}`,
      higherIsBetter: true,
      definition: "Shipped quantity × order line price for shipments dated from the 1st of this month through today. Compared with the same days of last month.",
      href: "/reports?report=revenue",
      spark,
    },
    {
      key: "open-orders",
      label: "Open sales order value",
      value: openValue,
      format: "currency",
      previous: openValuePrev,
      previousLabel: "vs 30 days ago",
      higherIsBetter: true,
      definition: "Unshipped quantity × price on confirmed, partially shipped and on-hold orders. The comparison reconstructs the backlog as of 30 days ago from confirmations, shipments and cancellations.",
      href: "/sales/orders?status=open",
    },
    {
      key: "otd",
      label: "On-time delivery",
      value: otd ?? 0,
      format: "percent",
      previous: otdPrev,
      previousLabel: "vs previous period",
      higherIsBetter: true,
      definition: `Share of shipment lines in the selected period (${f.range.label.toLowerCase()}) shipped on or before the line's promised date.`,
      href: "/reports?report=otd",
    },
    {
      key: "wo-schedule",
      label: "Work orders on schedule",
      value: wos.pct,
      format: "percent",
      previous: null,
      previousLabel: `${wos.onSchedule} of ${wos.total} open`,
      higherIsBetter: true,
      definition: "Open work orders (released, in progress, on hold) that are not on hold and not past their due date, as a share of all open work orders.",
      href: "/production?filter=late",
    },
    {
      key: "inventory",
      label: "Inventory value",
      value: invValue,
      format: "currency",
      previous: invValuePrev,
      previousLabel: "vs 30 days ago",
      higherIsBetter: false,
      definition: "On-hand quantity × current standard cost across all warehouses in scope (including held stock). The comparison replays the movement ledger to 30 days ago at today's standard costs.",
      href: "/inventory",
    },
    {
      key: "shortages",
      label: "Critical material shortages",
      value: critical,
      format: "number",
      previous: null,
      previousLabel: `${shortages.length} shortage line${shortages.length === 1 ? "" : "s"} total`,
      higherIsBetter: false,
      definition: "Items whose usable stock minus open work-order and sales-order demand is negative and is not covered by approved purchase orders or open work orders due within 14 days.",
      href: "/inventory?filter=shortage",
    },
    {
      key: "quality",
      label: "Open quality issues",
      value: quality,
      format: "number",
      previous: qualityPrev,
      previousLabel: "vs 30 days ago",
      higherIsBetter: false,
      definition: "NCRs, complaints, deviations and audit findings that are open, investigating or pending disposition.",
      href: "/quality",
    },
  ];
}

// ---------------------------------------------------------------------------
// Shortages & alerts
// ---------------------------------------------------------------------------
export interface Shortage {
  itemId: string;
  sku: string;
  name: string;
  warehouseCode: string;
  usable: number;
  demand: number;
  incoming: number;
  net: number;
  needDate: string | null;
  critical: boolean;
}

export async function getShortages(db: Sql, ctx: ServiceContext, f: Pick<DashboardFilters, "siteId" | "today" | "family">): Promise<Shortage[]> {
  const rows = await db.query<{ item_id: string; sku: string; name: string; wh: string; usable: string; demand: string; incoming: string; need_date: string | null }>(
    `with dem as (
       select m.component_item_id as item_id, wo.material_warehouse_id as warehouse_id,
              sum(greatest(m.quantity_required - m.quantity_issued, 0)) as q, min(wo.planned_start) as need
       from work_order_materials m join work_orders wo on wo.id = m.work_order_id
       where wo.organization_id = $1 and wo.status in ('released','in_progress','on_hold') group by 1, 2
       union all
       select l.item_id, so.warehouse_id, sum(l.quantity_ordered - l.quantity_shipped), min(l.promised_date)
       from sales_order_lines l join sales_orders so on so.id = l.sales_order_id
       where so.organization_id = $1 and so.status in ('confirmed','partially_shipped','on_hold') and l.quantity_shipped < l.quantity_ordered group by 1, 2
     ), demand as (
       select item_id, warehouse_id, sum(q) as q, min(need) as need from dem group by 1, 2
     ), sup as (
       select pol.item_id, po.warehouse_id, sum(pol.quantity_ordered - pol.quantity_received) as q
       from purchase_order_lines pol join purchase_orders po on po.id = pol.purchase_order_id
       where po.organization_id = $1 and po.status in ('approved','partially_received') and pol.expected_date <= $4::date + 14 group by 1, 2
       union all
       select wo.item_id, wo.warehouse_id, sum(wo.quantity_planned - wo.quantity_completed - wo.quantity_scrapped)
       from work_orders wo where wo.organization_id = $1 and wo.status in ('released','in_progress') and wo.due_date <= $4::date + 14 group by 1, 2
     ), supply as (select item_id, warehouse_id, sum(q) as q from sup group by 1, 2),
     usable as (
       select b.item_id, b.warehouse_id, sum(b.qty_on_hand) as q from inventory_balances b left join inventory_lots l on l.id = b.lot_id
       where b.organization_id = $1 and (l.id is null or (l.status = 'available' and (l.expires_on is null or l.expires_on >= $4::date))) group by 1, 2
     )
     select d.item_id, i.sku, i.name, w.code as wh, coalesce(u.q, 0) as usable, d.q as demand, coalesce(s.q, 0) as incoming, d.need::text as need_date
     from demand d join items i on i.id = d.item_id join warehouses w on w.id = d.warehouse_id
     left join usable u on u.item_id = d.item_id and u.warehouse_id = d.warehouse_id
     left join supply s on s.item_id = d.item_id and s.warehouse_id = d.warehouse_id
     where ${siteWh} and ${famItem} and coalesce(u.q, 0) - d.q < 0
     order by (coalesce(u.q, 0) - d.q + coalesce(s.q, 0)) asc`,
    [ctx.orgId, f.siteId, f.family, f.today],
  );
  return rows.map((r) => {
    const usable = num(r.usable);
    const demand = num(r.demand);
    const incoming = num(r.incoming);
    const net = usable - demand;
    return { itemId: r.item_id, sku: r.sku, name: r.name, warehouseCode: r.wh, usable, demand, incoming, net, needDate: r.need_date, critical: net + incoming < 0 };
  });
}

export interface InventoryAlert {
  kind: "critical_shortage" | "shortage" | "below_safety" | "expiring" | "expired" | "on_hold" | "unallocated";
  severity: "critical" | "serious" | "warning";
  title: string;
  detail: string;
  href: string;
}

export async function getInventoryAlerts(db: Sql, ctx: ServiceContext, f: DashboardFilters): Promise<InventoryAlert[]> {
  const alerts: InventoryAlert[] = [];
  const shortages = await getShortages(db, ctx, f);
  for (const s of shortages) {
    alerts.push({
      kind: s.critical ? "critical_shortage" : "shortage",
      severity: s.critical ? "critical" : "serious",
      title: `${s.sku} short ${fmtQty(-s.net)} at ${s.warehouseCode}`,
      detail: `${fmtQty(s.usable)} usable vs ${fmtQty(s.demand)} demanded${s.needDate ? ` (first need ${formatDate(s.needDate, { year: false })})` : ""}; ${s.incoming > 0 ? `${fmtQty(s.incoming)} inbound within 14 days` : "no inbound supply within 14 days"}`,
      href: `/inventory/items/${s.itemId}`,
    });
  }
  const below = await db.query<{ id: string; sku: string; usable: string; safety_stock: string }>(
    `select i.id, i.sku, coalesce(sum(b.qty_on_hand) filter (where (l.id is null or l.status = 'available') and ${siteWh}), 0) as usable, i.safety_stock
     from items i left join inventory_balances b on b.item_id = i.id left join inventory_lots l on l.id = b.lot_id
     left join warehouses w on w.id = b.warehouse_id
     where i.organization_id = $1 and i.safety_stock > 0 and i.lifecycle_status = 'active' and ${famItem}
     group by i.id, i.sku, i.safety_stock having coalesce(sum(b.qty_on_hand) filter (where (l.id is null or l.status = 'available') and ${siteWh}), 0) < i.safety_stock
     order by i.sku`,
    [ctx.orgId, f.siteId, f.family],
  );
  for (const b of below) {
    if (shortages.some((s) => s.itemId === b.id)) continue;
    alerts.push({
      kind: "below_safety",
      severity: "warning",
      title: `${b.sku} below safety stock`,
      detail: `${fmtQty(num(b.usable))} usable vs safety stock ${fmtQty(num(b.safety_stock))}`,
      href: `/inventory/items/${b.id}`,
    });
  }
  const lots = await db.query<{ lot_id: string; item_id: string; sku: string; lot_number: string; status: string; expires_on: string | null; qty: string; wh: string }>(
    `select l.id as lot_id, l.item_id, i.sku, l.lot_number, l.status, l.expires_on::text, sum(b.qty_on_hand) as qty, min(w.code) as wh
     from inventory_lots l join inventory_balances b on b.lot_id = l.id join items i on i.id = l.item_id join warehouses w on w.id = b.warehouse_id
     where l.organization_id = $1 and b.qty_on_hand > 0 and ${siteWh} and ${famItem}
       and (l.status <> 'available' or (l.expires_on is not null and l.expires_on <= $4::date + 30))
     group by l.id, l.item_id, i.sku, l.lot_number, l.status, l.expires_on
     order by l.expires_on nulls last`,
    [ctx.orgId, f.siteId, f.family, f.today],
  );
  for (const l of lots) {
    if (l.status !== "available") {
      alerts.push({
        kind: "on_hold",
        severity: "serious",
        title: `Lot ${l.lot_number} (${l.sku}) ${l.status === "hold" ? "on quality hold" : "in quarantine"}`,
        detail: `${fmtQty(num(l.qty))} blocked from issue and shipment at ${l.wh}`,
        href: `/inventory/lots?lot=${encodeURIComponent(l.lot_number)}`,
      });
    } else if (l.expires_on) {
      const days = diffDays(l.expires_on, f.today);
      alerts.push({
        kind: days < 0 ? "expired" : "expiring",
        severity: days < 0 ? "serious" : "warning",
        title: days < 0 ? `Lot ${l.lot_number} (${l.sku}) expired` : `Lot ${l.lot_number} (${l.sku}) expires in ${days} day${days === 1 ? "" : "s"}`,
        detail: `${fmtQty(num(l.qty))} on hand at ${l.wh}; expiry ${formatDate(l.expires_on)}`,
        href: `/inventory/lots?lot=${encodeURIComponent(l.lot_number)}`,
      });
    }
  }
  const unallocated = await db.query<{ wo_id: string; wo_number: string; sku: string; gap: string }>(
    `select wo.id as wo_id, wo.wo_number, i.sku,
            greatest(m.quantity_required - m.quantity_issued, 0) - coalesce(r.quantity, 0) as gap
     from work_order_materials m join work_orders wo on wo.id = m.work_order_id join items i on i.id = m.component_item_id
     join warehouses w on w.id = wo.material_warehouse_id
     left join inventory_reservations r on r.demand_type = 'work_order_material' and r.demand_id = m.id and r.status = 'open'
     where wo.organization_id = $1 and wo.status = 'released' and ${siteWh}
       and greatest(m.quantity_required - m.quantity_issued, 0) - coalesce(r.quantity, 0) > 0
     order by wo.planned_start limit 8`,
    [ctx.orgId, f.siteId],
  );
  for (const u of unallocated) {
    alerts.push({
      kind: "unallocated",
      severity: "warning",
      title: `${u.wo_number}: ${fmtQty(num(u.gap))} ${u.sku} unallocated`,
      detail: "Released work order requirement not yet covered by an allocation",
      href: `/production/work-orders/${u.wo_id}`,
    });
  }
  const rank = { critical: 0, serious: 1, warning: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function fmtQty(n: number) {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------
export interface TrendPoint {
  bucket: string;
  label: string;
  a: number;
  b: number;
}

function buckets(f: DashboardFilters): { grain: "week" | "month"; keys: string[] } {
  const grain = f.range.days > 120 ? "month" : "week";
  const keys: string[] = [];
  if (grain === "week") {
    for (let d = startOfWeek(f.range.from); d <= f.range.to; d = addDays(d, 7)) keys.push(d);
  } else {
    for (let d = startOfMonth(f.range.from); d <= f.range.to; d = addMonths(d, 1)) keys.push(d);
  }
  return { grain, keys };
}

function bucketLabel(key: string, grain: "week" | "month") {
  const date = new Date(`${key}T00:00:00Z`);
  return grain === "month"
    ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export async function getOrderTrend(db: Sql, ctx: ServiceContext, f: DashboardFilters) {
  const { grain, keys } = buckets(f);
  const [intake, shipped] = await Promise.all([
    db.query<{ k: string; v: string }>(
      `select date_trunc($6, so.order_date::timestamp)::date::text as k, sum(l.quantity_ordered * l.unit_price) as v
       from sales_order_lines l join sales_orders so on so.id = l.sales_order_id
       join warehouses w on w.id = so.warehouse_id join items i on i.id = l.item_id
       where so.organization_id = $1 and ${siteWh} and ${famItem} and so.status not in ('draft','canceled')
         and so.order_date between $4 and $5 group by 1`,
      params(ctx, f, f.range.from, f.range.to, grain),
    ),
    db.query<{ k: string; v: string }>(
      `select date_trunc($6, sh.ship_date::timestamp)::date::text as k, sum(sl.quantity * sl.unit_price) as v
       from shipment_lines sl join shipments sh on sh.id = sl.shipment_id
       join warehouses w on w.id = sh.warehouse_id join items i on i.id = sl.item_id
       where sh.organization_id = $1 and ${siteWh} and ${famItem} and sh.ship_date between $4 and $5 group by 1`,
      params(ctx, f, f.range.from, f.range.to, grain),
    ),
  ]);
  const im = new Map(intake.map((r) => [r.k, num(r.v)]));
  const sm = new Map(shipped.map((r) => [r.k, num(r.v)]));
  const points: TrendPoint[] = keys.map((k) => ({ bucket: k, label: bucketLabel(k, grain), a: im.get(k) ?? 0, b: sm.get(k) ?? 0 }));
  return { grain, points, totals: { intake: sum(points.map((p) => p.a)), shipped: sum(points.map((p) => p.b)) } };
}

export async function getProductionTrend(db: Sql, ctx: ServiceContext, f: DashboardFilters) {
  const { grain, keys } = buckets(f);
  const fg = `(i.item_type = 'manufactured' and i.list_price is not null)`;
  const [planned, actual] = await Promise.all([
    db.query<{ k: string; v: string }>(
      `select date_trunc($6, wo.due_date::timestamp)::date::text as k, sum(wo.quantity_planned) as v
       from work_orders wo join warehouses w on w.id = wo.warehouse_id join items i on i.id = wo.item_id
       where wo.organization_id = $1 and ${siteWh} and ${famItem} and ${fg} and wo.status <> 'canceled'
         and wo.due_date between $4 and $5 group by 1`,
      params(ctx, f, f.range.from, f.range.to, grain),
    ),
    db.query<{ k: string; v: string; scrap: string }>(
      `select date_trunc($6, (pr.recorded_at at time zone $7)::date::timestamp)::date::text as k, sum(pr.quantity_good) as v, sum(pr.quantity_scrap) as scrap
       from production_receipts pr join warehouses w on w.id = pr.warehouse_id join items i on i.id = pr.item_id
       where pr.organization_id = $1 and ${siteWh} and ${famItem} and ${fg}
         and (pr.recorded_at at time zone $7)::date between $4 and $5 group by 1`,
      params(ctx, f, f.range.from, f.range.to, grain, ctx.timezone),
    ),
  ]);
  const pm = new Map(planned.map((r) => [r.k, num(r.v)]));
  const am = new Map(actual.map((r) => [r.k, num(r.v)]));
  const points: TrendPoint[] = keys.map((k) => ({ bucket: k, label: bucketLabel(k, grain), a: pm.get(k) ?? 0, b: am.get(k) ?? 0 }));
  const scrap = sum(actual.map((r) => num(r.scrap)));
  const good = sum(points.map((p) => p.b));
  return {
    grain,
    points,
    totals: { planned: sum(points.map((p) => p.a)), actual: good, scrapRate: good + scrap > 0 ? (scrap / (good + scrap)) * 100 : 0 },
  };
}

export const BACKLOG_BUCKETS = ["Overdue", "Next 7 days", "8–14 days", "15–28 days", "Later"] as const;

export async function getBacklog(db: Sql, ctx: ServiceContext, f: DashboardFilters) {
  const rows = await db.query<{ bucket: string; status: string; v: string; n: number }>(
    `select case
              when l.promised_date < $4::date then 'Overdue'
              when l.promised_date <= $4::date + 7 then 'Next 7 days'
              when l.promised_date <= $4::date + 14 then '8–14 days'
              when l.promised_date <= $4::date + 28 then '15–28 days'
              else 'Later' end as bucket,
            so.status, sum((l.quantity_ordered - l.quantity_shipped) * l.unit_price) as v, count(distinct so.id) as n
     from sales_order_lines l join sales_orders so on so.id = l.sales_order_id
     join warehouses w on w.id = so.warehouse_id join items i on i.id = l.item_id
     where so.organization_id = $1 and ${siteWh} and ${famItem} and so.status in ('confirmed','partially_shipped','on_hold')
       and l.quantity_shipped < l.quantity_ordered
     group by 1, 2`,
    params(ctx, f, f.today),
  );
  return BACKLOG_BUCKETS.map((bucket) => {
    const pick = (status: string) => num(rows.find((r) => r.bucket === bucket && r.status === status)?.v);
    return { bucket, confirmed: pick("confirmed"), partially_shipped: pick("partially_shipped"), on_hold: pick("on_hold") };
  });
}

export interface QueueRow {
  id: string;
  number: string;
  sku: string;
  itemName: string;
  planned: number;
  completed: number;
  scrapped: number;
  progress: number;
  plannedStart: string;
  dueDate: string;
  workCenter: string | null;
  status: string;
  late: boolean;
  blocker: string | null;
  priority: string;
}

export async function getProductionQueue(db: Sql, ctx: ServiceContext, f: Pick<DashboardFilters, "siteId" | "family" | "today">, limit = 12): Promise<QueueRow[]> {
  const rows = await db.query<{
    id: string; wo_number: string; sku: string; name: string; quantity_planned: string; quantity_completed: string; quantity_scrapped: string;
    planned_start: string; due_date: string; wc: string | null; status: string; hold_reason: string | null; priority: string; short_sku: string | null; short_count: number; held_sku: string | null;
  }>(
    `with usable as (
       select b.item_id, b.warehouse_id, sum(b.qty_on_hand) filter (where l.id is null or (l.status = 'available' and (l.expires_on is null or l.expires_on >= $4::date))) as q,
              sum(b.qty_on_hand) filter (where l.id is not null and (l.status <> 'available' or (l.expires_on is not null and l.expires_on < $4::date))) as held
       from inventory_balances b left join inventory_lots l on l.id = b.lot_id where b.organization_id = $1 group by 1, 2
     ), reserved as (
       select item_id, warehouse_id, sum(quantity) as q from inventory_reservations where organization_id = $1 and status = 'open' group by 1, 2
     ), mat as (
       select m.work_order_id, i.sku,
              greatest(m.quantity_required - m.quantity_issued, 0) as remaining,
              coalesce(u.q, 0) - coalesce(rv.q, 0) + coalesce(own.quantity, 0) as avail,
              coalesce(u.held, 0) as held
       from work_order_materials m join work_orders wo on wo.id = m.work_order_id join items i on i.id = m.component_item_id
       left join usable u on u.item_id = m.component_item_id and u.warehouse_id = wo.material_warehouse_id
       left join reserved rv on rv.item_id = m.component_item_id and rv.warehouse_id = wo.material_warehouse_id
       left join inventory_reservations own on own.demand_type = 'work_order_material' and own.demand_id = m.id and own.status = 'open'
       where wo.organization_id = $1 and wo.status in ('draft','released','in_progress','on_hold')
     )
     select wo.id, wo.wo_number, i.sku, i.name, wo.quantity_planned, wo.quantity_completed, wo.quantity_scrapped, wo.planned_start::text, wo.due_date::text,
            wc.code as wc, wo.status, wo.hold_reason, wo.priority,
            (select mat.sku from mat where mat.work_order_id = wo.id and mat.remaining > mat.avail order by mat.sku limit 1) as short_sku,
            (select count(*) from mat where mat.work_order_id = wo.id and mat.remaining > mat.avail) as short_count,
            (select mat.sku from mat where mat.work_order_id = wo.id and mat.remaining > mat.avail and mat.avail + mat.held >= mat.remaining limit 1) as held_sku
     from work_orders wo join items i on i.id = wo.item_id join warehouses w on w.id = wo.warehouse_id
     left join work_centers wc on wc.id = wo.work_center_id
     where wo.organization_id = $1 and ${siteWh} and ${famItem} and wo.status in ('draft','released','in_progress','on_hold')
     order by (wo.due_date < $4::date) desc, wo.due_date, wo.wo_number
     limit ${Math.max(1, Math.min(200, limit))}`,
    [ctx.orgId, f.siteId, f.family, f.today],
  );
  return rows.map((r) => {
    const planned = num(r.quantity_planned);
    const completed = num(r.quantity_completed);
    const scrapped = num(r.quantity_scrapped);
    let blocker: string | null = null;
    if (r.status === "on_hold") blocker = r.hold_reason ?? "On hold";
    else if (r.held_sku) blocker = `${r.held_sku} on quality hold`;
    else if (r.short_sku) blocker = `Short: ${r.short_sku}${Number(r.short_count) > 1 ? ` +${Number(r.short_count) - 1}` : ""}`;
    return {
      id: r.id,
      number: r.wo_number,
      sku: r.sku,
      itemName: r.name,
      planned,
      completed,
      scrapped,
      progress: planned > 0 ? Math.min(100, ((completed + scrapped) / planned) * 100) : 0,
      plannedStart: r.planned_start,
      dueDate: r.due_date,
      workCenter: r.wc,
      status: r.status,
      late: r.due_date < f.today,
      blocker,
      priority: r.priority,
    };
  });
}

export async function getQualitySummary(db: Sql, ctx: ServiceContext, f: DashboardFilters) {
  const bySeverity = await db.query<{ severity: string; n: number }>(
    `select severity, count(*) as n from quality_events
     where organization_id = $1 and ($2::uuid is null or site_id is null or site_id = $2::uuid)
       and status in ('open','investigating','pending_disposition') group by 1`,
    [ctx.orgId, f.siteId],
  );
  const overdue = await db.query<{ kind: string; id: string; href_id: string; number: string; title: string; due_date: string; owner: string | null; severity: string | null }>(
    `select 'capa' as kind, c.id, coalesce(c.quality_event_id, c.id) as href_id, c.capa_number as number, c.description as title, c.due_date::text, p.full_name as owner, q.severity
     from capa_actions c left join profiles p on p.id = c.owner_id left join quality_events q on q.id = c.quality_event_id
     where c.organization_id = $1 and c.status in ('open','in_progress') and c.due_date < $3::date
     union all
     select 'event', q.id, q.id, q.event_number, q.title, q.due_date::text, p.full_name, q.severity
     from quality_events q left join profiles p on p.id = q.owner_id
     where q.organization_id = $1 and ($2::uuid is null or q.site_id is null or q.site_id = $2::uuid)
       and q.status in ('open','investigating','pending_disposition') and q.due_date < $3::date
     order by 6`,
    [ctx.orgId, f.siteId, f.today],
  );
  const severity = ["critical", "high", "medium", "low"].map((s) => ({ severity: s, count: Number(bySeverity.find((r) => r.severity === s)?.n ?? 0) }));
  const [holds] = await db.query<{ n: number; qty: string }>(
    `select count(distinct h.lot_id) as n, coalesce(sum(b.qty_on_hand), 0) as qty
     from quality_holds h left join inventory_balances b on b.lot_id = h.lot_id where h.organization_id = $1 and h.status = 'active'`,
    [ctx.orgId],
  );
  return { severity, overdue: overdue.map((o) => ({ ...o, daysOverdue: diffDays(f.today, o.due_date) })), activeHolds: Number(holds.n), heldQty: num(holds.qty) };
}

export interface ActivityItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityNumber: string | null;
  summary: string;
  actor: string;
  occurredAt: string;
  seed: boolean;
}

export async function getActivity(db: Sql, ctx: ServiceContext, opts: { siteId?: string | null; limit?: number; entityType?: string; entityId?: string } = {}): Promise<ActivityItem[]> {
  const rows = await db.query<{ id: string; action: string; entity_type: string; entity_id: string | null; entity_number: string | null; summary: string; actor_name: string; occurred_at: Date; metadata: { seed?: boolean } | null }>(
    `select id, action, entity_type, entity_id, entity_number, summary, actor_name, occurred_at, metadata
     from audit_events
     where organization_id = $1 and ($2::uuid is null or site_id is null or site_id = $2::uuid)
       and ($3::text is null or entity_type = $3::text) and ($4::uuid is null or entity_id = $4::uuid)
     order by occurred_at desc, seq desc limit ${Math.max(1, Math.min(500, opts.limit ?? 15))}`,
    [ctx.orgId, opts.siteId ?? null, opts.entityType ?? null, opts.entityId ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityNumber: r.entity_number,
    summary: r.summary,
    actor: r.actor_name,
    occurredAt: new Date(r.occurred_at).toISOString(),
    seed: !!r.metadata?.seed,
  }));
}

export async function getProductFamilies(db: Sql, ctx: ServiceContext): Promise<string[]> {
  const rows = await db.query<{ product_family: string }>(
    `select distinct product_family from items where organization_id = $1 and product_family is not null order by 1`,
    [ctx.orgId],
  );
  return rows.map((r) => r.product_family);
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}
