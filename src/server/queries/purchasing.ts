import type { Sql } from "../db";
import { authorize, type ServiceContext } from "../context";
import { NotFoundError } from "../errors";
import { num } from "@/lib/decimal";
import { getActivity } from "./dashboard";

export async function listPurchaseOrders(db: Sql, ctx: ServiceContext, siteId: string | null, today: string) {
  authorize(ctx, "purchasing.view");
  const rows = await db.query<{
    id: string; po_number: string; status: string; supplier: string; supplier_id: string; order_date: string; expected_date: string;
    total: string; received_value: string; lines: number; wh: string; source: string;
  }>(
    `select po.id, po.po_number, po.status, s.name as supplier, s.id as supplier_id, po.order_date::text, po.expected_date::text,
            coalesce(sum(l.quantity_ordered * l.unit_cost), 0) as total, coalesce(sum(l.quantity_received * l.unit_cost), 0) as received_value,
            count(l.id) as lines, w.code as wh, po.source
     from purchase_orders po join suppliers s on s.id = po.supplier_id join warehouses w on w.id = po.warehouse_id
     left join purchase_order_lines l on l.purchase_order_id = po.id
     where po.organization_id = $1 and ($2::uuid is null or w.site_id = $2::uuid)
     group by po.id, s.name, s.id, w.code order by po.order_date desc, po.po_number desc`,
    [ctx.orgId, siteId],
  );
  return rows.map((r) => ({
    ...r,
    total: num(r.total),
    receivedPct: num(r.total) > 0 ? (num(r.received_value) / num(r.total)) * 100 : 0,
    lines: Number(r.lines),
    late: ["approved", "partially_received"].includes(r.status) && r.expected_date < today,
  }));
}

export async function getPurchaseOrder(db: Sql, ctx: ServiceContext, id: string) {
  authorize(ctx, "purchasing.view");
  const [po] = await db.query<{
    id: string; po_number: string; status: string; supplier: string; supplier_id: string; supplier_code: string; order_date: string; expected_date: string;
    notes: string | null; source: string; wh: string; warehouse_id: string; site: string; created_by: string | null; approved_by: string | null; approved_at: Date | null; created_at: Date;
  }>(
    `select po.id, po.po_number, po.status, s.name as supplier, s.id as supplier_id, s.code as supplier_code, po.order_date::text, po.expected_date::text, po.notes, po.source,
            w.code as wh, w.id as warehouse_id, st.name as site, cb.full_name as created_by, ab.full_name as approved_by, po.approved_at, po.created_at
     from purchase_orders po join suppliers s on s.id = po.supplier_id join warehouses w on w.id = po.warehouse_id join sites st on st.id = po.site_id
     left join profiles cb on cb.id = po.created_by left join profiles ab on ab.id = po.approved_by
     where po.id = $1 and po.organization_id = $2`,
    [id, ctx.orgId],
  );
  if (!po) throw new NotFoundError("Purchase order");
  const lines = await db.query<{ id: string; line_no: number; item_id: string; sku: string; name: string; uom: string; tracking: string; shelf_life_days: number | null; quantity_ordered: string; quantity_received: string; unit_cost: string; expected_date: string; standard_cost: string }>(
    `select l.id, l.line_no, l.item_id, i.sku, i.name, i.uom, i.tracking, i.shelf_life_days, l.quantity_ordered, l.quantity_received, l.unit_cost, l.expected_date::text, i.standard_cost
     from purchase_order_lines l join items i on i.id = l.item_id where l.purchase_order_id = $1 order by l.line_no`,
    [id],
  );
  const receipts = await db.query<{ receipt_number: string; sku: string; quantity: string; lot_number: string | null; lot_status: string | null; received_at: Date; received_by: string | null; bin: string | null }>(
    `select gr.receipt_number, i.sku, gr.quantity, l.lot_number, l.status as lot_status, gr.received_at, p.full_name as received_by, b.code as bin
     from goods_receipts gr join items i on i.id = gr.item_id left join inventory_lots l on l.id = gr.lot_id left join profiles p on p.id = gr.received_by
     left join bins b on b.id = gr.bin_id where gr.purchase_order_id = $1 order by gr.received_at desc`,
    [id],
  );
  const bills = await db.query<{ id: string; bill_number: string; status: string; total: string; bill_date: string; due_date: string }>(
    `select id, bill_number, status, total, bill_date::text, due_date::text from supplier_bills where purchase_order_id = $1 order by bill_date`,
    [id],
  );
  const bins = await db.query<{ id: string; code: string }>(`select id, code from bins where warehouse_id = $1 order by code`, [po.warehouse_id]);
  const history = await getActivity(db, ctx, { entityType: "purchase_order", entityId: id, limit: 50 });
  const total = lines.reduce((s, l) => s + num(l.quantity_ordered) * num(l.unit_cost), 0);
  const receivedValue = lines.reduce((s, l) => s + num(l.quantity_received) * num(l.unit_cost), 0);
  return { po, lines, receipts, bills, bins, history, total, receivedValue };
}

export async function listOpenPoLines(db: Sql, ctx: ServiceContext, siteId: string | null, today: string) {
  authorize(ctx, "purchasing.view");
  const rows = await db.query<{ po_id: string; po_number: string; status: string; supplier: string; line_id: string; sku: string; name: string; tracking: string; open: string; ordered: string; expected_date: string; wh: string }>(
    `select po.id as po_id, po.po_number, po.status, s.name as supplier, l.id as line_id, i.sku, i.name, i.tracking,
            l.quantity_ordered - l.quantity_received as open, l.quantity_ordered as ordered, l.expected_date::text, w.code as wh
     from purchase_order_lines l join purchase_orders po on po.id = l.purchase_order_id join suppliers s on s.id = po.supplier_id
     join items i on i.id = l.item_id join warehouses w on w.id = po.warehouse_id
     where po.organization_id = $1 and ($2::uuid is null or w.site_id = $2::uuid) and po.status in ('approved','partially_received')
       and l.quantity_received < l.quantity_ordered
     order by l.expected_date, po.po_number, l.line_no`,
    [ctx.orgId, siteId],
  );
  return rows.map((r) => ({ ...r, open: num(r.open), ordered: num(r.ordered), late: r.expected_date < today }));
}

export async function listSuppliers(db: Sql, ctx: ServiceContext) {
  authorize(ctx, "purchasing.view");
  const rows = await db.query<{ id: string; code: string; name: string; contact_name: string | null; email: string | null; payment_terms_days: number; default_lead_time_days: number; rating: string | null; is_active: boolean; open_value: string; receipts: number; on_time: number; avg_lead: string | null; items: number }>(
    `select s.id, s.code, s.name, s.contact_name, s.email, s.payment_terms_days, s.default_lead_time_days, s.rating, s.is_active,
            coalesce((select sum((l.quantity_ordered - l.quantity_received) * l.unit_cost) from purchase_order_lines l join purchase_orders po on po.id = l.purchase_order_id
                      where po.supplier_id = s.id and po.status in ('approved','partially_received')), 0) as open_value,
            (select count(*) from goods_receipts gr join purchase_orders po on po.id = gr.purchase_order_id where po.supplier_id = s.id) as receipts,
            (select count(*) from goods_receipts gr join purchase_order_lines l on l.id = gr.purchase_order_line_id join purchase_orders po on po.id = gr.purchase_order_id
             where po.supplier_id = s.id and (gr.received_at at time zone $2)::date <= l.expected_date) as on_time,
            (select avg((gr.received_at at time zone $2)::date - po.order_date) from goods_receipts gr join purchase_orders po on po.id = gr.purchase_order_id where po.supplier_id = s.id) as avg_lead,
            (select count(*) from items i where i.preferred_supplier_id = s.id) as items
     from suppliers s where s.organization_id = $1 order by s.name`,
    [ctx.orgId, ctx.timezone],
  );
  return rows.map((r) => ({
    ...r,
    openValue: num(r.open_value),
    onTimePct: Number(r.receipts) > 0 ? (Number(r.on_time) / Number(r.receipts)) * 100 : null,
    avgLead: r.avg_lead === null ? null : num(r.avg_lead),
    items: Number(r.items),
    receipts: Number(r.receipts),
  }));
}
