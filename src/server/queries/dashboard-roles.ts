import type { Sql } from "../db";
import type { ServiceContext } from "../context";
import { addDays, type IsoDate } from "@/lib/dates";
import { num } from "@/lib/decimal";

interface Scope {
  siteId: string | null;
  today: IsoDate;
}

export async function getReceiptsDue(db: Sql, ctx: ServiceContext, s: Scope, days = 7) {
  const rows = await db.query<{ po_id: string; po_number: string; supplier: string; sku: string; item_id: string; open: string; expected_date: string; status: string; wh: string }>(
    `select po.id as po_id, po.po_number, sp.name as supplier, i.sku, i.id as item_id, pol.quantity_ordered - pol.quantity_received as open,
            pol.expected_date::text, po.status, w.code as wh
     from purchase_order_lines pol join purchase_orders po on po.id = pol.purchase_order_id
     join suppliers sp on sp.id = po.supplier_id join items i on i.id = pol.item_id join warehouses w on w.id = po.warehouse_id
     where po.organization_id = $1 and ($2::uuid is null or w.site_id = $2::uuid) and po.status in ('approved','partially_received')
       and pol.quantity_received < pol.quantity_ordered and pol.expected_date <= $3::date
     order by pol.expected_date, po.po_number limit 40`,
    [ctx.orgId, s.siteId, addDays(s.today, days)],
  );
  return rows.map((r) => ({ ...r, open: num(r.open), late: r.expected_date < s.today }));
}

export async function getShipmentsDue(db: Sql, ctx: ServiceContext, s: Scope, days = 7) {
  const rows = await db.query<{ so_id: string; so_number: string; customer: string; sku: string; open: string; promised_date: string; status: string; usable: string; wh: string }>(
    `select so.id as so_id, so.so_number, c.name as customer, i.sku, l.quantity_ordered - l.quantity_shipped as open, l.promised_date::text, so.status,
            coalesce((select sum(b.qty_on_hand) from inventory_balances b left join inventory_lots lt on lt.id = b.lot_id
                      where b.item_id = l.item_id and b.warehouse_id = so.warehouse_id and (lt.id is null or lt.status = 'available')), 0) as usable,
            w.code as wh
     from sales_order_lines l join sales_orders so on so.id = l.sales_order_id join customers c on c.id = so.customer_id
     join items i on i.id = l.item_id join warehouses w on w.id = so.warehouse_id
     where so.organization_id = $1 and ($2::uuid is null or w.site_id = $2::uuid) and so.status in ('confirmed','partially_shipped')
       and l.quantity_shipped < l.quantity_ordered and l.promised_date <= $3::date
     order by l.promised_date, so.so_number limit 40`,
    [ctx.orgId, s.siteId, addDays(s.today, days)],
  );
  return rows.map((r) => ({ ...r, open: num(r.open), usable: num(r.usable), late: r.promised_date < s.today }));
}

export async function getRecentMovements(db: Sql, ctx: ServiceContext, s: Pick<Scope, "siteId">, limit = 12) {
  return db.query<{ id: string; movement_type: string; sku: string; item_id: string; quantity: string; wh: string; lot_number: string | null; reference_number: string | null; occurred_at: Date; actor: string | null }>(
    `select m.id, m.movement_type, i.sku, i.id as item_id, m.quantity, w.code as wh, l.lot_number, m.reference_number, m.occurred_at, p.full_name as actor
     from inventory_movements m join items i on i.id = m.item_id join warehouses w on w.id = m.warehouse_id
     left join inventory_lots l on l.id = m.lot_id left join profiles p on p.id = m.actor_id
     where m.organization_id = $1 and ($2::uuid is null or w.site_id = $2::uuid)
     order by m.occurred_at desc, m.seq desc limit ${Math.max(1, Math.min(200, limit))}`,
    [ctx.orgId, s.siteId],
  );
}

export async function getOpenQualityEvents(db: Sql, ctx: ServiceContext, s: Scope) {
  const rows = await db.query<{ id: string; event_number: string; event_type: string; title: string; severity: string; status: string; due_date: string | null; owner: string | null; lot_number: string | null; sku: string | null; opened_at: Date }>(
    `select q.id, q.event_number, q.event_type, q.title, q.severity, q.status, q.due_date::text, p.full_name as owner, l.lot_number, i.sku, q.opened_at
     from quality_events q left join profiles p on p.id = q.owner_id left join inventory_lots l on l.id = q.lot_id left join items i on i.id = q.item_id
     where q.organization_id = $1 and ($2::uuid is null or q.site_id is null or q.site_id = $2::uuid)
       and q.status in ('open','investigating','pending_disposition')
     order by case q.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, q.opened_at`,
    [ctx.orgId, s.siteId],
  );
  return rows.map((r) => ({ ...r, overdue: !!r.due_date && r.due_date < s.today }));
}

export async function getActiveHolds(db: Sql, ctx: ServiceContext) {
  const rows = await db.query<{ id: string; lot_id: string; lot_number: string; sku: string; item_id: string; qty: string; reason: string; placed_at: Date; placed_by: string | null; event_id: string | null; event_number: string | null }>(
    `select h.id, h.lot_id, l.lot_number, i.sku, i.id as item_id, coalesce((select sum(b.qty_on_hand) from inventory_balances b where b.lot_id = h.lot_id), 0) as qty,
            h.reason, h.placed_at, p.full_name as placed_by, q.id as event_id, q.event_number
     from quality_holds h join inventory_lots l on l.id = h.lot_id join items i on i.id = h.item_id
     left join profiles p on p.id = h.placed_by left join quality_events q on q.id = h.quality_event_id
     where h.organization_id = $1 and h.status = 'active' order by h.placed_at desc`,
    [ctx.orgId],
  );
  return rows.map((r) => ({ ...r, qty: num(r.qty) }));
}

export async function getInspectionStats(db: Sql, ctx: ServiceContext, from: IsoDate, to: IsoDate) {
  const [row] = await db.query<{ total: number; passed: number; inspected: string; rejected: string }>(
    `select count(*) as total, count(*) filter (where result = 'pass') as passed,
            coalesce(sum(quantity_inspected), 0) as inspected, coalesce(sum(quantity_rejected), 0) as rejected
     from inspections where organization_id = $1 and (inspected_at at time zone $4)::date between $2 and $3`,
    [ctx.orgId, from, to, ctx.timezone],
  );
  return { total: Number(row.total), passed: Number(row.passed), inspected: num(row.inspected), rejected: num(row.rejected) };
}

export async function getLastMrpRun(db: Sql, ctx: ServiceContext) {
  const [run] = await db.query<{ id: string; run_number: string; completed_at: Date; horizon_days: number; summary: Record<string, number>; open: number }>(
    `select r.id, r.run_number, r.completed_at, r.horizon_days, r.summary,
            (select count(*) from mrp_suggestions s where s.mrp_run_id = r.id and s.status = 'open') as open
     from mrp_runs r where r.organization_id = $1 order by r.started_at desc limit 1`,
    [ctx.orgId],
  );
  return run ?? null;
}
