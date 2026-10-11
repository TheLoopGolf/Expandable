/**
 * Replays ~6 months of operations through the real service layer so every balance,
 * KPI and chart in the demo is derived from posted transactions.
 */
import type { Database } from "../db";
import { addDays, diffDays, type IsoDate } from "@/lib/dates";
import { add, ceilUnit, cmp, dec, max, min, mul, sub, toStr, type Dec } from "@/lib/decimal";
import { approvePurchaseOrder, createPurchaseOrder, createSupplierBill, paySupplierBill, receivePurchaseOrder } from "../services/purchasing";
import { closeWorkOrder, createWorkOrder, issueMaterials, materialReadiness, recordProduction } from "../services/production";
import { createSalesOrder, issueInvoice, recordCustomerPayment, shipSalesOrder } from "../services/sales";
import { countAdjust, receiveStock } from "../services/inventory";
import { createCapa, openQualityEvent, recordInspection, releaseLotHold, updateCapaStatus, updateQualityEvent } from "../services/quality";
import { WEEKLY_DEMAND, PRODUCTION_SITE } from "./data";
import type { World } from "./master";
import { dow, idemKey, isWeekday, startOfDayInstant, yymmdd, type Rng, SeedClock } from "./util";

interface PoPlan {
  arrival: IsoDate;
  partial: boolean;
}

interface PendingQuality {
  eventId: string;
  holdId: string | null;
  capaId: string | null;
  resolveOn: IsoDate;
  outcome: "release" | "close_only" | "keep_open";
}

export interface SimState {
  poPlans: Map<string, PoPlan>;
  invoicePayDelay: Map<string, number>;
  pendingQuality: PendingQuality[];
  completedOn: Map<string, IsoDate>;
}

const round5 = (n: number) => Math.max(5, Math.ceil(n / 5) * 5);

async function stockSnapshot(db: Database, world: World, horizon: IsoDate) {
  const rows = await db.query<{ item_id: string; warehouse_id: string; usable: string; po_open: string; wo_out: string; wo_demand: string; so_demand: string }>(
    `with bal as (
       select b.item_id, b.warehouse_id, sum(b.qty_on_hand) as q from inventory_balances b left join inventory_lots l on l.id = b.lot_id
       where b.organization_id = $1 and (l.id is null or l.status = 'available') group by 1, 2),
     po as (
       select pol.item_id, po.warehouse_id, sum(pol.quantity_ordered - pol.quantity_received) as q
       from purchase_order_lines pol join purchase_orders po on po.id = pol.purchase_order_id
       where po.organization_id = $1 and po.status in ('draft','approved','partially_received') group by 1, 2),
     woo as (
       select wo.item_id, wo.warehouse_id, sum(wo.quantity_planned - wo.quantity_completed - wo.quantity_scrapped) as q
       from work_orders wo where wo.organization_id = $1 and wo.status in ('draft','released','in_progress','on_hold') group by 1, 2),
     wod as (
       select m.component_item_id as item_id, wo.material_warehouse_id as warehouse_id, sum(greatest(m.quantity_required - m.quantity_issued, 0)) as q
       from work_order_materials m join work_orders wo on wo.id = m.work_order_id
       where wo.organization_id = $1 and wo.status in ('draft','released','in_progress','on_hold') group by 1, 2),
     sod as (
       select l.item_id, so.warehouse_id, sum(l.quantity_ordered - l.quantity_shipped) as q
       from sales_order_lines l join sales_orders so on so.id = l.sales_order_id
       where so.organization_id = $1 and so.status in ('confirmed','partially_shipped') and l.promised_date <= $2 group by 1, 2)
     select item_id, warehouse_id, coalesce(bal.q, 0) as usable, coalesce(po.q, 0) as po_open, coalesce(woo.q, 0) as wo_out,
            coalesce(wod.q, 0) as wo_demand, coalesce(sod.q, 0) as so_demand
     from bal full join po using (item_id, warehouse_id) full join woo using (item_id, warehouse_id)
          full join wod using (item_id, warehouse_id) full join sod using (item_id, warehouse_id)`,
    [world.org.id, horizon],
  );
  const map = new Map<string, { usable: Dec; poOpen: Dec; woOut: Dec; woDemand: Dec; soDemand: Dec }>();
  for (const r of rows) {
    map.set(`${r.item_id}:${r.warehouse_id}`, {
      usable: dec(r.usable),
      poOpen: dec(r.po_open),
      woOut: dec(r.wo_out),
      woDemand: dec(r.wo_demand),
      soDemand: dec(r.so_demand),
    });
  }
  return map;
}

export async function openingBalances(db: Database, world: World, rng: Rng, start: IsoDate) {
  const ctx = world.ctx.sam;
  for (const s of world.stocking) {
    const item = world.itemsById.get(s.itemId)!;
    const fraction = item.type === "manufactured" ? 0.85 : 0.75;
    const qtyNum = Number(toStr(s.reorderPoint)) + Number(toStr(sub(s.target, s.reorderPoint))) * fraction;
    const quantity = Math.max(1, Math.round(qtyNum));
    const whCode = Object.entries(world.warehouses).find(([, w]) => w.id === s.warehouseId)![0];
    const lotNumber = item.tracking === "lot" ? `${item.supplier ?? "INT"}-${yymmdd(addDays(start, -rng.int(5, 40)))}-OB` : undefined;
    await receiveStock(db, ctx, {
      itemId: item.id,
      warehouseId: s.warehouseId,
      binId: rng.pick(world.bins[whCode]),
      quantity: String(quantity),
      lotNumber,
      expiresOn: item.shelfLife ? addDays(start, Math.round(item.shelfLife * rng.float(0.45, 0.9))) : undefined,
      reason: "Opening balance (system cut-over)",
      opening: true,
    });
  }
}

function demandScale(progress: number) {
  // gentle growth over the period so trend charts are meaningful
  return 0.9 + 0.25 * progress;
}

async function createDailyOrders(db: Database, world: World, rng: Rng, d: IsoDate, progress: number) {
  const lines: { sku: string; qty: number }[] = [];
  for (const [sku, weekly] of Object.entries(WEEKLY_DEMAND)) {
    const avgLine = Math.max(2, Math.round(weekly * 0.55));
    const p = Math.min(0.95, ((weekly * demandScale(progress)) / avgLine) / 5);
    if (rng.chance(p)) lines.push({ sku, qty: Math.max(1, Math.round(avgLine * rng.float(0.5, 1.5))) });
  }
  // group into orders per warehouse
  const byWh = new Map<string, { sku: string; qty: number }[]>();
  for (const l of lines) {
    const wh = world.items[l.sku].wh;
    byWh.set(wh, [...(byWh.get(wh) ?? []), l]);
  }
  for (const [wh, group] of byWh) {
    while (group.length) {
      const take = group.splice(0, rng.int(1, 3));
      const customer = rng.pick(world.customers);
      const promised = addDays(d, rng.int(5, 24));
      await createSalesOrder(db, world.ctx.taylor, {
        customerId: customer.id,
        warehouseId: world.warehouses[wh].id,
        orderDate: d,
        requestedDate: addDays(promised, -rng.int(0, 4)),
        promisedDate: promised,
        customerPo: `${customer.code}-${rng.int(10000, 99999)}`,
        confirm: true,
        lines: take.map((l) => {
          const list = Number(world.items[l.sku].price);
          const discount = rng.pick([1, 1, 1, 0.97, 0.95]);
          return { itemId: world.items[l.sku].id, quantity: String(l.qty), unitPrice: (list * discount).toFixed(2) };
        }),
      });
    }
  }
}

async function receiveDuePurchases(db: Database, world: World, rng: Rng, state: SimState, d: IsoDate) {
  const pos = await db.query<{ id: string; po_number: string; supplier_code: string; status: string }>(
    `select po.id, po.po_number, s.code as supplier_code, po.status from purchase_orders po join suppliers s on s.id = po.supplier_id
     where po.organization_id = $1 and po.status in ('approved','partially_received') order by po.expected_date`,
    [world.org.id],
  );
  for (const po of pos) {
    const plan = state.poPlans.get(po.id);
    if (!plan || plan.arrival > d) continue;
    const lines = await db.query<{ id: string; item_id: string; open: string }>(
      `select id, item_id, quantity_ordered - quantity_received as open from purchase_order_lines where purchase_order_id = $1 and quantity_received < quantity_ordered`,
      [po.id],
    );
    if (lines.length === 0) continue;
    const firstPartial = plan.partial && po.status === "approved";
    const receiveLines = lines.map((l, i) => {
      const item = world.itemsById.get(l.item_id)!;
      let qty = dec(l.open);
      if (firstPartial && i === 0) qty = max(dec(Math.max(1, Math.floor(Number(l.open) * 0.6))), 1n * 10_000n);
      return {
        lineId: l.id,
        quantity: toStr(min(qty, dec(l.open))),
        lotNumber: item.tracking === "lot" ? `${po.supplier_code}-${yymmdd(d)}-${String(rng.int(1, 99)).padStart(2, "0")}` : undefined,
        expiresOn: item.shelfLife ? addDays(d, Math.round(item.shelfLife * rng.float(0.8, 1))) : undefined,
      };
    });
    const result = await receivePurchaseOrder(db, world.ctx.sam, { purchaseOrderId: po.id, idempotencyKey: idemKey("gr"), lines: receiveLines });
    if (firstPartial) state.poPlans.set(po.id, { arrival: addDays(d, rng.int(3, 6)), partial: false });
    // occasional incoming inspection record
    if (rng.chance(0.18)) {
      const first = receiveLines[0];
      const item = world.itemsById.get(lines[0].item_id)!;
      const [lot] = first.lotNumber
        ? await db.query<{ id: string }>(`select id from inventory_lots where organization_id = $1 and item_id = $2 and lot_number = $3`, [world.org.id, item.id, first.lotNumber])
        : [];
      const inspected = Math.max(1, Math.min(32, Math.round(Number(first.quantity) * 0.1)));
      await recordInspection(db, world.ctx.casey, {
        inspectionType: "incoming",
        itemId: item.id,
        lotId: lot?.id ?? null,
        purchaseOrderId: po.id,
        quantityInspected: String(inspected),
        quantityRejected: "0",
        result: "pass",
        notes: `Sampling per receiving plan (${result.receipts[0]?.number ?? po.po_number})`,
      });
    }
  }
}

async function runProduction(db: Database, world: World, rng: Rng, state: SimState, d: IsoDate) {
  const wos = await db.query<{ id: string; item_id: string; wo_number: string; status: string; planned_start: string; due_date: string; quantity_planned: string; quantity_completed: string; quantity_scrapped: string; to_issue: boolean }>(
    `select id, item_id, wo_number, status, planned_start, due_date, quantity_planned, quantity_completed, quantity_scrapped,
            exists (select 1 from work_order_materials m where m.work_order_id = work_orders.id and m.quantity_issued < m.quantity_required) as to_issue
     from work_orders where organization_id = $1 and status in ('released','in_progress') and planned_start <= $2
     order by due_date, wo_number`,
    [world.org.id, d],
  );
  for (const wo of wos) {
    if (wo.to_issue) {
      const readiness = await materialReadiness(db, world.ctx.sam, wo.id);
      const toIssue = readiness.filter((r) => dec(r.remaining) > 0n);
      const late = diffDays(d, wo.due_date) > 4;
      const allReady = toIssue.every((r) => cmp(dec(r.availableForOrder), dec(r.remaining)) >= 0);
      if (!allReady && !late) continue;
      const lines = toIssue
        .map((r) => ({ materialId: r.materialId, quantity: toStr(min(dec(r.remaining), dec(r.availableForOrder))) }))
        .filter((l) => dec(l.quantity) > 0n);
      if (lines.length === 0) continue;
      await issueMaterials(db, world.ctx.sam, { workOrderId: wo.id, idempotencyKey: idemKey("iss"), lines });
      continue; // build starts the next working day
    }
    const planned = dec(wo.quantity_planned);
    const done = add(dec(wo.quantity_completed), dec(wo.quantity_scrapped));
    const remaining = sub(planned, done);
    if (remaining <= 0n) continue;
    const plannedNum = Number(toStr(planned));
    const lead = world.itemsById.get(wo.item_id)?.lead ?? 4;
    const chunkNum = Math.min(Number(toStr(remaining)), Math.ceil((plannedNum / Math.max(2, lead - 1)) * rng.float(0.8, 1.3)));
    let chunk = min(dec(chunkNum), remaining);
    let scrap = 0n;
    if (plannedNum >= 10 && rng.chance(0.3)) {
      scrap = min(dec(Math.max(1, Math.round(chunkNum * 0.03))), chunk);
      if (scrap === chunk) scrap = 0n;
    }
    chunk = sub(chunk, scrap);
    try {
      const res = await recordProduction(db, world.ctx.riley, {
        workOrderId: wo.id,
        quantityGood: toStr(chunk),
        quantityScrap: toStr(scrap),
        idempotencyKey: idemKey("prd"),
        notes: scrap > 0n ? rng.pick(["Solder bridge rework failed", "Cosmetic damage at final assembly", "Failed end-of-line test", "Leak test failure"]) : undefined,
      });
      if (res.status === "completed") state.completedOn.set(wo.id, d);
    } catch {
      // material partially issued (late order) — output limited; leave for next day
    }
  }
  // close orders completed at least two days ago
  for (const [woId, completed] of [...state.completedOn]) {
    if (diffDays(d, completed) >= 2) {
      await closeWorkOrder(db, world.ctx.jordan, woId);
      state.completedOn.delete(woId);
    }
  }
}

async function shipOrders(db: Database, world: World, rng: Rng, state: SimState, d: IsoDate) {
  const lines = await db.query<{ so_id: string; line_id: string; item_id: string; warehouse_id: string; open: string; promised_date: string; customer_id: string }>(
    `select so.id as so_id, l.id as line_id, l.item_id, so.warehouse_id, l.quantity_ordered - l.quantity_shipped as open, l.promised_date, so.customer_id
     from sales_order_lines l join sales_orders so on so.id = l.sales_order_id
     where so.organization_id = $1 and so.status in ('confirmed','partially_shipped') and l.quantity_shipped < l.quantity_ordered
       and l.promised_date <= $2
     order by l.promised_date, so.so_number, l.line_no`,
    [world.org.id, addDays(d, 2)],
  );
  const available = new Map<string, Dec>();
  const usable = await db.query<{ item_id: string; warehouse_id: string; usable: string; reserved: string }>(
    `select b.item_id, b.warehouse_id, sum(b.qty_on_hand) as usable,
            coalesce((select sum(r.quantity) from inventory_reservations r where r.item_id = b.item_id and r.warehouse_id = b.warehouse_id and r.status = 'open'), 0) as reserved
     from inventory_balances b left join inventory_lots l on l.id = b.lot_id
     where b.organization_id = $1 and (l.id is null or l.status = 'available') group by b.item_id, b.warehouse_id`,
    [world.org.id],
  );
  for (const u of usable) available.set(`${u.item_id}:${u.warehouse_id}`, sub(dec(u.usable), dec(u.reserved)));

  const bySo = new Map<string, { lineId: string; quantity: string }[]>();
  for (const l of lines) {
    const key = `${l.item_id}:${l.warehouse_id}`;
    const avail = available.get(key) ?? 0n;
    if (avail <= 0n) continue;
    const open = dec(l.open);
    let qty = min(open, avail);
    const lateBy = diffDays(d, l.promised_date);
    // ship complete lines when possible; partials only when the line is due/late
    if (cmp(qty, open) < 0 && lateBy < 0) continue;
    if (cmp(qty, open) < 0 && Number(toStr(qty)) < 2) continue;
    qty = dec(Math.floor(Number(toStr(qty))));
    if (qty <= 0n) continue;
    available.set(key, sub(avail, qty));
    bySo.set(l.so_id, [...(bySo.get(l.so_id) ?? []), { lineId: l.line_id, quantity: toStr(qty) }]);
  }
  for (const [soId, shipLines] of bySo) {
    const res = await shipSalesOrder(db, world.ctx.sam, {
      salesOrderId: soId,
      idempotencyKey: idemKey("sh"),
      carrier: rng.pick(["Northbound Freight", "Lakes Parcel", "Prairie LTL", "Customer pickup"]),
      trackingNumber: `TRK${rng.int(100000000, 999999999)}`,
      lines: shipLines,
    });
    if (res.invoice) {
      await issueInvoice(db, world.ctx.morgan, res.invoice.id);
      state.invoicePayDelay.set(res.invoice.id, rng.weighted([
        { value: rng.int(-8, 0), weight: 55 },
        { value: rng.int(1, 14), weight: 30 },
        { value: rng.int(15, 40), weight: 11 },
        { value: 999, weight: 4 },
      ]));
    }
  }
}

async function financeDaily(db: Database, world: World, state: SimState, d: IsoDate) {
  const due = await db.query<{ id: string; due_date: string }>(
    `select id, due_date from invoices where organization_id = $1 and status = 'issued'`,
    [world.org.id],
  );
  for (const inv of due) {
    const delay = state.invoicePayDelay.get(inv.id) ?? 0;
    if (delay >= 999) continue;
    if (diffDays(d, inv.due_date) >= delay) await recordCustomerPayment(db, world.ctx.morgan, inv.id, undefined, d);
  }
  const toBill = await db.query<{ id: string }>(
    `select po.id from purchase_orders po
     where po.organization_id = $1 and po.status in ('received','partially_received')
       and exists (select 1 from goods_receipts gr where gr.purchase_order_id = po.id and gr.received_at < $2::timestamptz - interval '3 days')
       and coalesce((select sum(gr.quantity * gr.unit_cost) from goods_receipts gr where gr.purchase_order_id = po.id), 0)
           > coalesce((select sum(b.total) from supplier_bills b where b.purchase_order_id = po.id), 0) + 0.01`,
    [world.org.id, `${d}T12:00:00Z`],
  );
  for (const po of toBill) await createSupplierBill(db, world.ctx.morgan, po.id, d);
  const bills = await db.query<{ id: string }>(
    `select id from supplier_bills where organization_id = $1 and status = 'open' and due_date <= $2`,
    [world.org.id, d],
  );
  for (const b of bills) await paySupplierBill(db, world.ctx.morgan, b.id, d);
}

async function plan(db: Database, world: World, rng: Rng, state: SimState, d: IsoDate, progress: number) {
  const horizon = addDays(d, 21);
  // stocking levels follow the demand trend
  const scale = dec(demandScale(progress).toFixed(2));
  const scaled = (x: Dec) => ceilUnit(mul(x, scale));
  const startOffset = rng.int(1, 3);
  const start0 = addDays(d, startOffset);
  const start = dow(start0) === 6 ? addDays(start0, 2) : dow(start0) === 0 ? addDays(start0, 1) : start0;
  // 1) finished goods, 2) subassemblies (after FG orders add demand), 3) purchased parts
  for (const level of ["FG-", "SA-"]) {
    const snap = await stockSnapshot(db, world, horizon);
    for (const s of world.stocking) {
      const item = world.itemsById.get(s.itemId)!;
      if (item.type !== "manufactured" || !item.sku.startsWith(level)) continue;
      if (world.warehouses[item.wh].id !== s.warehouseId) continue;
      const v = snap.get(`${s.itemId}:${s.warehouseId}`);
      const projected = v ? sub(add(v.usable, v.woOut), add(v.soDemand, v.woDemand)) : 0n;
      if (cmp(projected, scaled(s.reorderPoint)) >= 0) continue;
      const qty = round5(Math.max(Number(item.moq), Number(toStr(sub(scaled(s.target), projected)))));
      const site = PRODUCTION_SITE[item.sku];
      await createWorkOrder(db, world.ctx.riley, {
        itemId: item.id,
        quantity: String(qty),
        plannedStart: start,
        dueDate: addDays(start, Math.max(2, item.lead)),
        warehouseId: s.warehouseId,
        materialWarehouseId: world.materialWarehouse[site],
        priority: cmp(projected, 0n) < 0 ? "high" : rng.pick(["normal", "normal", "low"]),
        release: true,
      });
    }
  }
  const snap = await stockSnapshot(db, world, horizon);
  const orders = new Map<string, { supplierId: string; warehouseId: string; lead: number; lines: { itemId: string; quantity: string; unitCost: string }[] }>();
  for (const s of world.stocking) {
    const item = world.itemsById.get(s.itemId)!;
    if (item.type !== "purchased" || !item.supplier) continue;
    const v = snap.get(`${s.itemId}:${s.warehouseId}`);
    const projected = v ? sub(add(v.usable, v.poOpen), v.woDemand) : 0n;
    if (cmp(projected, scaled(s.reorderPoint)) >= 0) continue;
    const moq = Number(item.moq);
    const need = Number(toStr(sub(scaled(s.target), projected)));
    const qty = Math.max(moq, Math.ceil(need / moq) * moq);
    const supplierId = world.suppliers[item.supplier];
    const key = `${supplierId}:${s.warehouseId}`;
    const entry = orders.get(key) ?? { supplierId, warehouseId: s.warehouseId, lead: 0, lines: [] };
    entry.lead = Math.max(entry.lead, item.lead);
    const price = Number(toStr(item.standardCost)) * rng.float(0.96, 1.06);
    entry.lines.push({ itemId: item.id, quantity: String(qty), unitCost: price.toFixed(4) });
    orders.set(key, entry);
  }
  for (const o of orders.values()) {
    const expected = addDays(d, o.lead);
    const po = await createPurchaseOrder(db, world.ctx.riley, {
      supplierId: o.supplierId,
      warehouseId: o.warehouseId,
      orderDate: d,
      expectedDate: expected,
      lines: o.lines,
    });
    await approvePurchaseOrder(db, world.ctx.jordan, po.id);
    const delay = rng.weighted([
      { value: rng.int(-2, 1), weight: 60 },
      { value: rng.int(2, 5), weight: 26 },
      { value: rng.int(6, 14), weight: 14 },
    ]);
    state.poPlans.set(po.id, { arrival: addDays(expected, delay), partial: rng.chance(0.12) });
  }
}

const INCOMING_ISSUES = [
  "Dimensional nonconformance on incoming sample",
  "Certificate of conformance missing lot traceability",
  "Cosmetic scratches exceed acceptance criteria",
  "Solderability test marginal on sample",
];
const PROCESS_ISSUES = [
  "Elevated first-pass yield loss at end-of-line test",
  "Torque audit found under-torqued enclosure screws",
  "Potting voids observed on cross-section",
  "Label misprint on rating plate",
];
const CUSTOMER_ISSUES = [
  "Customer reported intermittent output signal",
  "Unit arrived with damaged connector",
  "Calibration certificate missing from shipment",
];

async function qualityActivity(db: Database, world: World, rng: Rng, state: SimState, d: IsoDate) {
  // resolve pending events
  for (const p of [...state.pendingQuality]) {
    if (p.resolveOn > d) continue;
    state.pendingQuality.splice(state.pendingQuality.indexOf(p), 1);
    if (p.outcome === "keep_open") continue;
    await updateQualityEvent(db, world.ctx.casey, { id: p.eventId, status: "investigating", rootCause: "Investigation completed; see CAPA" });
    if (p.capaId) await updateCapaStatus(db, world.ctx.casey, p.capaId, "verified", "Effectiveness confirmed over subsequent lots");
    if (p.holdId) {
      await releaseLotHold(db, world.ctx.casey, { holdId: p.holdId, reason: "MRB review: material conforms after 100% re-inspection; use as is" });
    }
    await updateQualityEvent(db, world.ctx.casey, {
      id: p.eventId,
      status: "closed",
      disposition: p.holdId ? "use_as_is" : "rework",
      closureNotes: "Closed after MRB review and verification",
    });
  }
  if (!rng.chance(0.14)) return;
  const kind = rng.weighted([
    { value: "incoming" as const, weight: 45 },
    { value: "process" as const, weight: 35 },
    { value: "customer" as const, weight: 20 },
  ]);
  const severity = rng.weighted([
    { value: "low" as const, weight: 25 },
    { value: "medium" as const, weight: 45 },
    { value: "high" as const, weight: 23 },
    { value: "critical" as const, weight: 7 },
  ]);
  if (kind === "incoming") {
    const [lot] = await db.query<{ id: string; item_id: string; lot_number: string; supplier_id: string | null }>(
      `select l.id, l.item_id, l.lot_number, l.supplier_id from inventory_lots l
       where l.organization_id = $1 and l.origin = 'purchase' and l.status = 'available' and l.received_on >= $2
         and exists (select 1 from inventory_balances b where b.lot_id = l.id and b.qty_on_hand > 0)
       order by random() limit 1`,
      [world.org.id, addDays(d, -10)],
    );
    if (!lot) return;
    const ev = await openQualityEvent(db, world.ctx.casey, {
      eventType: "ncr",
      title: rng.pick(INCOMING_ISSUES),
      severity,
      source: "incoming",
      lotId: lot.id,
      supplierId: lot.supplier_id,
      dueDate: addDays(d, 14),
      placeHold: true,
      holdReason: `Incoming nonconformance on lot ${lot.lot_number}; segregated pending MRB`,
    });
    const capa = rng.chance(0.5)
      ? await createCapa(db, world.ctx.casey, { qualityEventId: ev.id, actionType: "corrective", description: "Supplier corrective action request (SCAR) issued", dueDate: addDays(d, 21) })
      : null;
    state.pendingQuality.push({ eventId: ev.id, holdId: ev.holdId, capaId: capa?.id ?? null, resolveOn: addDays(d, rng.int(4, 12)), outcome: rng.chance(0.85) ? "release" : "keep_open" });
  } else if (kind === "process") {
    const [wo] = await db.query<{ id: string; item_id: string }>(
      `select id, item_id from work_orders where organization_id = $1 and status in ('in_progress','completed','closed') and planned_start >= $2 order by random() limit 1`,
      [world.org.id, addDays(d, -14)],
    );
    if (!wo) return;
    const ev = await openQualityEvent(db, world.ctx.casey, {
      eventType: "ncr",
      title: rng.pick(PROCESS_ISSUES),
      severity,
      source: "in_process",
      workOrderId: wo.id,
      itemId: wo.item_id,
      quantityAffected: String(rng.int(1, 6)),
      dueDate: addDays(d, 10),
    });
    const capa = await createCapa(db, world.ctx.casey, {
      qualityEventId: ev.id,
      actionType: rng.pick(["corrective", "preventive"] as const),
      description: rng.pick(["Update work instruction and retrain operators", "Add torque verification step", "Revise potting cure profile", "Add label verification at pack-out"]),
      dueDate: addDays(d, rng.int(10, 30)),
    });
    state.pendingQuality.push({ eventId: ev.id, holdId: null, capaId: capa.id, resolveOn: addDays(d, rng.int(6, 20)), outcome: rng.chance(0.8) ? "close_only" : "keep_open" });
  } else {
    const [so] = await db.query<{ id: string; customer_id: string }>(
      `select id, customer_id from sales_orders where organization_id = $1 and status in ('shipped','partially_shipped') order by random() limit 1`,
      [world.org.id],
    );
    if (!so) return;
    const ev = await openQualityEvent(db, world.ctx.casey, {
      eventType: "complaint",
      title: rng.pick(CUSTOMER_ISSUES),
      severity,
      source: "customer",
      salesOrderId: so.id,
      customerId: so.customer_id,
      dueDate: addDays(d, 15),
    });
    state.pendingQuality.push({ eventId: ev.id, holdId: null, capaId: null, resolveOn: addDays(d, rng.int(8, 25)), outcome: rng.chance(0.75) ? "close_only" : "keep_open" });
  }
}

async function cycleCount(db: Database, world: World, rng: Rng) {
  const [bal] = await db.query<{ item_id: string; warehouse_id: string; bin_id: string | null; lot_id: string | null; qty_on_hand: string }>(
    `select b.item_id, b.warehouse_id, b.bin_id, b.lot_id, b.qty_on_hand from inventory_balances b join items i on i.id = b.item_id
     where b.organization_id = $1 and b.qty_on_hand > 20 and i.item_type = 'purchased' order by random() limit 1`,
    [world.org.id],
  );
  if (!bal) return;
  const system = Number(bal.qty_on_hand);
  const counted = Math.max(0, Math.round(system + rng.pick([-3, -2, -1, 1, 2]) * Math.max(1, Math.round(system * 0.005))));
  if (counted === Math.round(system) && Math.abs(system - counted) < 0.0001) return;
  try {
    await countAdjust(db, world.ctx.sam, {
      itemId: bal.item_id,
      warehouseId: bal.warehouse_id,
      binId: bal.bin_id,
      lotId: bal.lot_id,
      countedQuantity: String(counted),
      reason: "Scheduled ABC cycle count",
    });
  } catch {
    /* count matched */
  }
}

export async function simulate(
  db: Database,
  world: World,
  rng: Rng,
  clock: SeedClock,
  start: IsoDate,
  end: IsoDate,
  log: (msg: string) => void,
): Promise<SimState> {
  const state: SimState = { poPlans: new Map(), invoicePayDelay: new Map(), pendingQuality: [], completedOn: new Map() };
  const total = diffDays(end, start);
  for (let i = 0; i <= total; i++) {
    const d = addDays(start, i);
    if (!isWeekday(d)) continue;
    const progress = i / total;
    clock.set(new Date(startOfDayInstant(d, world.org.timezone).getTime() + 7.5 * 3_600_000));
    await timed("receive", () => receiveDuePurchases(db, world, rng, state, d));
    await timed("produce", () => runProduction(db, world, rng, state, d));
    await timed("ship", () => shipOrders(db, world, rng, state, d));
    await timed("finance", () => financeDaily(db, world, state, d));
    await timed("orders", () => createDailyOrders(db, world, rng, d, progress));
    if (dow(d) === 1 || dow(d) === 3 || dow(d) === 5) await timed("plan", () => plan(db, world, rng, state, d, progress));
    await timed("quality", () => qualityActivity(db, world, rng, state, d));
    if (dow(d) === 5) await cycleCount(db, world, rng);
    if (i % 30 === 0) log(`  simulated through ${d}`);
  }
  if (process.env.SEED_PROFILE) console.table(Object.fromEntries([...timings].map(([k, v]) => [k, Math.round(v)])));
  return state;
}

const timings = new Map<string, number>();
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now();
  try {
    return await fn();
  } finally {
    timings.set(label, (timings.get(label) ?? 0) + performance.now() - t);
  }
}
