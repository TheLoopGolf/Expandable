import type { Sql } from "../db";
import { authorize, type ServiceContext } from "../context";
import { NotFoundError } from "../errors";
import { num } from "@/lib/decimal";
import { materialReadiness } from "../services/production";
import { getActivity, getProductionQueue } from "./dashboard";

export async function listWorkOrders(db: Sql, ctx: ServiceContext, siteId: string | null, today: string) {
  authorize(ctx, "production.view");
  const rows = await db.query<{
    id: string; wo_number: string; status: string; priority: string; sku: string; name: string; family: string | null; quantity_planned: string; quantity_completed: string;
    quantity_scrapped: string; planned_start: string; due_date: string; wc: string | null; source: string; site: string;
  }>(
    `select wo.id, wo.wo_number, wo.status, wo.priority, i.sku, i.name, i.product_family as family, wo.quantity_planned, wo.quantity_completed, wo.quantity_scrapped,
            wo.planned_start::text, wo.due_date::text, wc.code as wc, wo.source, st.code as site
     from work_orders wo join items i on i.id = wo.item_id join sites st on st.id = wo.site_id left join work_centers wc on wc.id = wo.work_center_id
     where wo.organization_id = $1 and ($2::uuid is null or wo.site_id = $2::uuid)
     order by case when wo.status in ('released','in_progress','on_hold','draft') then 0 else 1 end, wo.due_date desc, wo.wo_number desc`,
    [ctx.orgId, siteId],
  );
  const queue = await getProductionQueue(db, ctx, { siteId, family: null, today }, 200);
  const blockers = new Map(queue.map((q) => [q.id, q.blocker]));
  return rows.map((r) => {
    const planned = num(r.quantity_planned);
    const done = num(r.quantity_completed) + num(r.quantity_scrapped);
    const open = ["released", "in_progress", "on_hold"].includes(r.status);
    return {
      id: r.id,
      number: r.wo_number,
      status: r.status,
      priority: r.priority,
      sku: r.sku,
      name: r.name,
      family: r.family ?? "",
      planned,
      completed: num(r.quantity_completed),
      scrapped: num(r.quantity_scrapped),
      progress: planned ? Math.min(100, (done / planned) * 100) : 0,
      plannedStart: r.planned_start,
      dueDate: r.due_date,
      workCenter: r.wc ?? "",
      source: r.source,
      site: r.site,
      late: open && r.due_date < today,
      blocker: blockers.get(r.id) ?? null,
      scope: open ? "open" : r.status === "draft" ? "draft" : "done",
    };
  });
}

export async function getWorkOrder(db: Sql, ctx: ServiceContext, id: string) {
  authorize(ctx, "production.view");
  const [wo] = await db.query<{
    id: string; wo_number: string; status: string; priority: string; item_id: string; sku: string; name: string; uom: string; tracking: string; quantity_planned: string;
    quantity_completed: string; quantity_scrapped: string; planned_start: string; due_date: string; actual_start: Date | null; actual_end: Date | null; hold_reason: string | null;
    bom_id: string | null; bom_revision: string | null; bom_snapshot: { revision: string; capturedAt: string; lines: { lineNo: number; sku: string; name: string; quantityPer: string; scrapPct: string; uom: string }[] } | null;
    estimated_unit_cost: string; standard_cost: string; notes: string | null; source: string; wc: string | null; wh: string; mat_wh: string; mat_wh_id: string; site: string;
    created_by: string | null; released_by: string | null; released_at: Date | null; so_number: string | null; so_id: string | null;
  }>(
    `select wo.id, wo.wo_number, wo.status, wo.priority, wo.item_id, i.sku, i.name, i.uom, i.tracking, wo.quantity_planned, wo.quantity_completed, wo.quantity_scrapped,
            wo.planned_start::text, wo.due_date::text, wo.actual_start, wo.actual_end, wo.hold_reason, wo.bom_id, wo.bom_revision, wo.bom_snapshot,
            wo.estimated_unit_cost, i.standard_cost, wo.notes, wo.source, wc.code || ' — ' || wc.name as wc, w.code as wh, mw.code as mat_wh, mw.id as mat_wh_id, st.name as site,
            cb.full_name as created_by, rb.full_name as released_by, wo.released_at, so.so_number, so.id as so_id
     from work_orders wo join items i on i.id = wo.item_id join warehouses w on w.id = wo.warehouse_id join warehouses mw on mw.id = wo.material_warehouse_id
     join sites st on st.id = wo.site_id left join work_centers wc on wc.id = wo.work_center_id
     left join profiles cb on cb.id = wo.created_by left join profiles rb on rb.id = wo.released_by
     left join sales_order_lines sol on sol.id = wo.sales_order_line_id left join sales_orders so on so.id = sol.sales_order_id
     where wo.id = $1 and wo.organization_id = $2`,
    [id, ctx.orgId],
  );
  if (!wo) throw new NotFoundError("Work order");
  const readiness = await materialReadiness(db, ctx, id);
  const operations = await db.query<{ id: string; seq: number; description: string; wc: string; planned_hours: string; status: string; completed_at: Date | null }>(
    `select o.id, o.seq, o.description, wc.code as wc, o.planned_hours, o.status, o.completed_at
     from work_order_operations o join work_centers wc on wc.id = o.work_center_id where o.work_order_id = $1 order by o.seq`,
    [id],
  );
  const issues = await db.query<{ sku: string; quantity: string; lot_number: string | null; unit_cost: string; issued_at: Date; issued_by: string | null }>(
    `select i.sku, mi.quantity, l.lot_number, mi.unit_cost, mi.issued_at, p.full_name as issued_by
     from material_issues mi join items i on i.id = mi.item_id left join inventory_lots l on l.id = mi.lot_id left join profiles p on p.id = mi.issued_by
     where mi.work_order_id = $1 order by mi.issued_at desc`,
    [id],
  );
  const receipts = await db.query<{ quantity_good: string; quantity_scrap: string; lot_number: string | null; recorded_at: Date; recorded_by: string | null; notes: string | null }>(
    `select pr.quantity_good, pr.quantity_scrap, l.lot_number, pr.recorded_at, p.full_name as recorded_by, pr.notes
     from production_receipts pr left join inventory_lots l on l.id = pr.lot_id left join profiles p on p.id = pr.recorded_by
     where pr.work_order_id = $1 order by pr.recorded_at desc`,
    [id],
  );
  const lots = await db.query<{ id: string; item_id: string; lot_number: string; status: string; expires_on: string | null; qty: string }>(
    `select l.id, l.item_id, l.lot_number, l.status, l.expires_on::text, sum(b.qty_on_hand) as qty
     from inventory_lots l join inventory_balances b on b.lot_id = l.id
     where b.warehouse_id = $2 and b.qty_on_hand > 0 and l.item_id in (select component_item_id from work_order_materials where work_order_id = $1)
     group by l.id order by l.expires_on nulls last, l.created_at`,
    [id, wo.mat_wh_id],
  );
  const [cost] = await db.query<{ material: string }>(`select coalesce(sum(quantity * unit_cost), 0) as material from material_issues where work_order_id = $1`, [id]);
  const history = await getActivity(db, ctx, { entityType: "work_order", entityId: id, limit: 60 });
  const bins = await db.query<{ id: string; code: string }>(`select b.id, b.code from bins b join work_orders wo on wo.warehouse_id = b.warehouse_id where wo.id = $1 order by b.code`, [id]);
  return { wo, readiness, operations, issues, receipts, lots: lots.map((l) => ({ ...l, qty: num(l.qty) })), materialIssuedValue: num(cost.material), history, bins };
}

export async function getScheduleBoard(db: Sql, ctx: ServiceContext, siteId: string | null, today: string) {
  authorize(ctx, "production.view");
  const centers = await db.query<{ id: string; code: string; name: string; capacity_hours_per_day: string; site: string }>(
    `select wc.id, wc.code, wc.name, wc.capacity_hours_per_day, st.code as site from work_centers wc join sites st on st.id = wc.site_id
     where wc.organization_id = $1 and ($2::uuid is null or wc.site_id = $2::uuid) and wc.is_active order by st.code, wc.code`,
    [ctx.orgId, siteId],
  );
  const ops = await db.query<{ wc_id: string; wo_id: string; wo_number: string; sku: string; status: string; seq: number; description: string; planned_hours: string; planned_start: string; due_date: string; op_status: string; priority: string }>(
    `select o.work_center_id as wc_id, wo.id as wo_id, wo.wo_number, i.sku, wo.status, o.seq, o.description, o.planned_hours, wo.planned_start::text, wo.due_date::text, o.status as op_status, wo.priority
     from work_order_operations o join work_orders wo on wo.id = o.work_order_id join items i on i.id = wo.item_id
     where wo.organization_id = $1 and wo.status in ('draft','released','in_progress','on_hold') and o.status <> 'done'
     order by wo.due_date, wo.wo_number, o.seq`,
    [ctx.orgId],
  );
  const queue = await getProductionQueue(db, ctx, { siteId, family: null, today }, 200);
  const blockers = new Map(queue.map((q) => [q.id, q.blocker]));
  return centers.map((c) => {
    const list = ops.filter((o) => o.wc_id === c.id).map((o) => ({ ...o, hours: num(o.planned_hours), late: o.due_date < today, blocker: blockers.get(o.wo_id) ?? null }));
    const load = list.reduce((s, o) => s + o.hours, 0);
    return { ...c, capacity: num(c.capacity_hours_per_day), load, days: num(c.capacity_hours_per_day) ? load / num(c.capacity_hours_per_day) : 0, ops: list };
  });
}
