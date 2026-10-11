import type { Sql } from "../db";
import { authorize, type ServiceContext } from "../context";
import { NotFoundError } from "../errors";
import { num } from "@/lib/decimal";
import { getActivity, type ActivityItem } from "./dashboard";

export async function listQualityEvents(db: Sql, ctx: ServiceContext, today: string) {
  authorize(ctx, "quality.view");
  const rows = await db.query<{ id: string; event_number: string; event_type: string; title: string; severity: string; status: string; source: string; disposition: string | null; sku: string | null; lot_number: string | null; owner: string | null; due_date: string | null; opened_at: Date; closed_at: Date | null; supplier: string | null; customer: string | null; capas: number; hold_active: boolean }>(
    `select q.id, q.event_number, q.event_type, q.title, q.severity, q.status, q.source, q.disposition, i.sku, l.lot_number, p.full_name as owner,
            q.due_date::text, q.opened_at, q.closed_at, s.name as supplier, c.name as customer,
            (select count(*) from capa_actions ca where ca.quality_event_id = q.id) as capas,
            exists(select 1 from quality_holds h where h.quality_event_id = q.id and h.status = 'active') as hold_active
     from quality_events q left join items i on i.id = q.item_id left join inventory_lots l on l.id = q.lot_id left join profiles p on p.id = q.owner_id
     left join suppliers s on s.id = q.supplier_id left join customers c on c.id = q.customer_id
     where q.organization_id = $1 order by q.opened_at desc`,
    [ctx.orgId],
  );
  return rows.map((r) => {
    const open = ["open", "investigating", "pending_disposition"].includes(r.status);
    return { ...r, opened_at: new Date(r.opened_at).toISOString(), closed_at: r.closed_at ? new Date(r.closed_at).toISOString() : null, capas: Number(r.capas), open, overdue: open && !!r.due_date && r.due_date < today, scope: open ? "open" : "closed" };
  });
}

export async function getQualityEvent(db: Sql, ctx: ServiceContext, id: string) {
  authorize(ctx, "quality.view");
  const [ev] = await db.query<{
    id: string; event_number: string; event_type: string; title: string; description: string | null; severity: string; status: string; source: string; disposition: string | null;
    root_cause: string | null; closure_notes: string | null; quantity_affected: string | null; due_date: string | null; opened_at: Date; closed_at: Date | null;
    item_id: string | null; sku: string | null; item_name: string | null; lot_id: string | null; lot_number: string | null; lot_status: string | null;
    wo_id: string | null; wo_number: string | null; po_id: string | null; po_number: string | null; so_id: string | null; so_number: string | null;
    supplier: string | null; customer: string | null; owner: string | null; owner_id: string | null; opened_by: string | null; closed_by: string | null;
  }>(
    `select q.id, q.event_number, q.event_type, q.title, q.description, q.severity, q.status, q.source, q.disposition, q.root_cause, q.closure_notes, q.quantity_affected,
            q.due_date::text, q.opened_at, q.closed_at, q.item_id, i.sku, i.name as item_name, q.lot_id, l.lot_number, l.status as lot_status,
            q.work_order_id as wo_id, wo.wo_number, q.purchase_order_id as po_id, po.po_number, q.sales_order_id as so_id, so.so_number,
            s.name as supplier, c.name as customer, ow.full_name as owner, q.owner_id, ob.full_name as opened_by, cb.full_name as closed_by
     from quality_events q left join items i on i.id = q.item_id left join inventory_lots l on l.id = q.lot_id
     left join work_orders wo on wo.id = q.work_order_id left join purchase_orders po on po.id = q.purchase_order_id left join sales_orders so on so.id = q.sales_order_id
     left join suppliers s on s.id = q.supplier_id left join customers c on c.id = q.customer_id
     left join profiles ow on ow.id = q.owner_id left join profiles ob on ob.id = q.opened_by left join profiles cb on cb.id = q.closed_by
     where q.id = $1 and q.organization_id = $2`,
    [id, ctx.orgId],
  );
  if (!ev) throw new NotFoundError("Quality event");
  const holds = await db.query<{ id: string; lot_number: string; status: string; reason: string; placed_by: string | null; placed_at: Date; released_by: string | null; released_at: Date | null; release_reason: string | null; qty: string }>(
    `select h.id, l.lot_number, h.status, h.reason, pb.full_name as placed_by, h.placed_at, rb.full_name as released_by, h.released_at, h.release_reason,
            coalesce((select sum(b.qty_on_hand) from inventory_balances b where b.lot_id = h.lot_id), 0) as qty
     from quality_holds h join inventory_lots l on l.id = h.lot_id left join profiles pb on pb.id = h.placed_by left join profiles rb on rb.id = h.released_by
     where h.quality_event_id = $1 or ($2::uuid is not null and h.lot_id = $2::uuid) order by h.placed_at desc`,
    [id, ev.lot_id],
  );
  const capas = await db.query<{ id: string; capa_number: string; action_type: string; description: string; owner: string | null; due_date: string; status: string; verification_notes: string | null }>(
    `select c.id, c.capa_number, c.action_type, c.description, p.full_name as owner, c.due_date::text, c.status, c.verification_notes
     from capa_actions c left join profiles p on p.id = c.owner_id where c.quality_event_id = $1 order by c.created_at`,
    [id],
  );
  const lotQty = ev.lot_id
    ? await db.query<{ wh: string; qty: string }>(`select w.code as wh, sum(b.qty_on_hand) as qty from inventory_balances b join warehouses w on w.id = b.warehouse_id where b.lot_id = $1 and b.qty_on_hand > 0 group by w.code`, [ev.lot_id])
    : [];
  const history: ActivityItem[] = [
    ...(await getActivity(db, ctx, { entityType: "quality_event", entityId: id, limit: 40 })),
    ...(ev.lot_id ? await getActivity(db, ctx, { entityType: "lot", entityId: ev.lot_id, limit: 20 }) : []),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return { ev, holds: holds.map((h) => ({ ...h, qty: num(h.qty) })), capas, lotQty, history };
}

export async function listCapas(db: Sql, ctx: ServiceContext, today: string) {
  authorize(ctx, "quality.view");
  const rows = await db.query<{ id: string; capa_number: string; action_type: string; description: string; owner: string | null; due_date: string; status: string; event_id: string | null; event_number: string | null }>(
    `select c.id, c.capa_number, c.action_type, c.description, p.full_name as owner, c.due_date::text, c.status, q.id as event_id, q.event_number
     from capa_actions c left join profiles p on p.id = c.owner_id left join quality_events q on q.id = c.quality_event_id
     where c.organization_id = $1 order by case when c.status in ('open','in_progress') then 0 else 1 end, c.due_date`,
    [ctx.orgId],
  );
  return rows.map((r) => ({ ...r, overdue: ["open", "in_progress"].includes(r.status) && r.due_date < today }));
}

export async function listInspections(db: Sql, ctx: ServiceContext) {
  authorize(ctx, "quality.view");
  return db.query<{ id: string; inspection_number: string; inspection_type: string; sku: string; lot_number: string | null; po_number: string | null; wo_number: string | null; quantity_inspected: string; quantity_rejected: string; result: string; inspector: string | null; inspected_at: Date; notes: string | null }>(
    `select x.id, x.inspection_number, x.inspection_type, i.sku, l.lot_number, po.po_number, wo.wo_number, x.quantity_inspected, x.quantity_rejected, x.result,
            p.full_name as inspector, x.inspected_at, x.notes
     from inspections x join items i on i.id = x.item_id left join inventory_lots l on l.id = x.lot_id left join purchase_orders po on po.id = x.purchase_order_id
     left join work_orders wo on wo.id = x.work_order_id left join profiles p on p.id = x.inspector_id
     where x.organization_id = $1 order by x.inspected_at desc limit 500`,
    [ctx.orgId],
  );
}
