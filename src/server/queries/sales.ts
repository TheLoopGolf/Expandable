import type { Sql } from "../db";
import { authorize, type ServiceContext } from "../context";
import { NotFoundError } from "../errors";
import { num } from "@/lib/decimal";
import { getActivity } from "./dashboard";

export async function listSalesOrders(db: Sql, ctx: ServiceContext, siteId: string | null, today: string) {
  authorize(ctx, "sales.view");
  const rows = await db.query<{
    id: string; so_number: string; status: string; customer: string; customer_id: string; order_date: string; promised_date: string; customer_po: string | null;
    total: string; open_value: string; shipped_value: string; lines: number; wh: string; families: string[] | null;
  }>(
    `select so.id, so.so_number, so.status, c.name as customer, c.id as customer_id, so.order_date::text, so.promised_date::text, so.customer_po,
            coalesce(sum(l.quantity_ordered * l.unit_price), 0) as total,
            coalesce(sum((l.quantity_ordered - l.quantity_shipped) * l.unit_price), 0) as open_value,
            coalesce(sum(l.quantity_shipped * l.unit_price), 0) as shipped_value,
            count(l.id) as lines, w.code as wh, array_remove(array_agg(distinct i.product_family), null) as families
     from sales_orders so join customers c on c.id = so.customer_id join warehouses w on w.id = so.warehouse_id
     left join sales_order_lines l on l.sales_order_id = so.id left join items i on i.id = l.item_id
     where so.organization_id = $1 and ($2::uuid is null or w.site_id = $2::uuid)
     group by so.id, c.name, c.id, w.code order by so.order_date desc, so.so_number desc`,
    [ctx.orgId, siteId],
  );
  return rows.map((r) => {
    const open = ["confirmed", "partially_shipped", "on_hold"].includes(r.status);
    return {
      ...r,
      total: num(r.total),
      openValue: open ? num(r.open_value) : 0,
      shippedPct: num(r.total) > 0 ? (num(r.shipped_value) / num(r.total)) * 100 : 0,
      lines: Number(r.lines),
      late: open && r.promised_date < today,
      bucket: open ? "open" : r.status === "draft" ? "draft" : "done",
      family: (r.families ?? []).join(", "),
    };
  });
}

export async function getSalesOrder(db: Sql, ctx: ServiceContext, id: string, today: string) {
  authorize(ctx, "sales.view");
  const [so] = await db.query<{
    id: string; so_number: string; status: string; customer: string; customer_id: string; customer_code: string; order_date: string; requested_date: string | null;
    promised_date: string; customer_po: string | null; notes: string | null; wh: string; warehouse_id: string; site: string; created_by: string | null; payment_terms_days: number;
  }>(
    `select so.id, so.so_number, so.status, c.name as customer, c.id as customer_id, c.code as customer_code, so.order_date::text, so.requested_date::text,
            so.promised_date::text, so.customer_po, so.notes, w.code as wh, w.id as warehouse_id, st.name as site, p.full_name as created_by, c.payment_terms_days
     from sales_orders so join customers c on c.id = so.customer_id join warehouses w on w.id = so.warehouse_id join sites st on st.id = so.site_id
     left join profiles p on p.id = so.created_by where so.id = $1 and so.organization_id = $2`,
    [id, ctx.orgId],
  );
  if (!so) throw new NotFoundError("Sales order");
  const lines = await db.query<{
    id: string; line_no: number; item_id: string; sku: string; name: string; uom: string; quantity_ordered: string; quantity_shipped: string; quantity_invoiced: string;
    unit_price: string; promised_date: string; reserved: string; usable: string; reserved_all: string; standard_cost: string;
  }>(
    `select l.id, l.line_no, l.item_id, i.sku, i.name, i.uom, l.quantity_ordered, l.quantity_shipped, l.quantity_invoiced, l.unit_price, l.promised_date::text, i.standard_cost,
            coalesce((select r.quantity from inventory_reservations r where r.demand_type = 'sales_order_line' and r.demand_id = l.id and r.status = 'open'), 0) as reserved,
            coalesce((select sum(b.qty_on_hand) from inventory_balances b left join inventory_lots lt on lt.id = b.lot_id
                      where b.item_id = l.item_id and b.warehouse_id = $2 and (lt.id is null or (lt.status = 'available' and (lt.expires_on is null or lt.expires_on >= $3::date)))), 0) as usable,
            coalesce((select sum(r.quantity) from inventory_reservations r where r.item_id = l.item_id and r.warehouse_id = $2 and r.status = 'open'), 0) as reserved_all
     from sales_order_lines l join items i on i.id = l.item_id where l.sales_order_id = $1 order by l.line_no`,
    [id, so.warehouse_id, today],
  );
  const shipments = await db.query<{ id: string; shipment_number: string; ship_date: string; carrier: string | null; tracking_number: string | null; shipped_by: string | null; value: string; lines: { sku: string; quantity: string; lot_number: string | null }[] }>(
    `select sh.id, sh.shipment_number, sh.ship_date::text, sh.carrier, sh.tracking_number, p.full_name as shipped_by,
            coalesce(sum(sl.quantity * sl.unit_price), 0) as value,
            json_agg(json_build_object('sku', i.sku, 'quantity', sl.quantity::text, 'lot_number', lt.lot_number)) as lines
     from shipments sh join shipment_lines sl on sl.shipment_id = sh.id join items i on i.id = sl.item_id
     left join inventory_lots lt on lt.id = sl.lot_id left join profiles p on p.id = sh.shipped_by
     where sh.sales_order_id = $1 group by sh.id, p.full_name order by sh.shipped_at desc`,
    [id],
  );
  const invoices = await db.query<{ id: string; invoice_number: string; status: string; invoice_date: string; due_date: string; total: string; amount_paid: string }>(
    `select id, invoice_number, status, invoice_date::text, due_date::text, total, amount_paid from invoices where sales_order_id = $1 order by created_at`,
    [id],
  );
  const history = await getActivity(db, ctx, { entityType: "sales_order", entityId: id, limit: 60 });
  const enriched = lines.map((l) => {
    const ordered = num(l.quantity_ordered);
    const shipped = num(l.quantity_shipped);
    const reserved = num(l.reserved);
    const availableForLine = Math.max(0, num(l.usable) - num(l.reserved_all) + reserved);
    return { ...l, ordered, shipped, invoiced: num(l.quantity_invoiced), reserved, open: ordered - shipped, availableForLine, unitPrice: num(l.unit_price) };
  });
  const total = enriched.reduce((s, l) => s + l.ordered * l.unitPrice, 0);
  const shippedValue = enriched.reduce((s, l) => s + l.shipped * l.unitPrice, 0);
  const margin = enriched.reduce((s, l) => s + l.ordered * (l.unitPrice - num(l.standard_cost)), 0);
  return { so, lines: enriched, shipments, invoices, history, total, shippedValue, margin };
}

export async function listCustomers(db: Sql, ctx: ServiceContext, yearStart: string) {
  authorize(ctx, "sales.view");
  const rows = await db.query<{ id: string; code: string; name: string; segment: string | null; payment_terms_days: number; credit_limit: string | null; open_orders: string; ar: string; ytd: string; last_order: string | null; email: string | null }>(
    `select c.id, c.code, c.name, c.segment, c.payment_terms_days, c.credit_limit, c.email,
            coalesce((select sum((l.quantity_ordered - l.quantity_shipped) * l.unit_price) from sales_order_lines l join sales_orders so on so.id = l.sales_order_id
                      where so.customer_id = c.id and so.status in ('confirmed','partially_shipped','on_hold')), 0) as open_orders,
            coalesce((select sum(total - amount_paid) from invoices i where i.customer_id = c.id and i.status = 'issued'), 0) as ar,
            coalesce((select sum(sl.quantity * sl.unit_price) from shipment_lines sl join shipments sh on sh.id = sl.shipment_id join sales_orders so on so.id = sh.sales_order_id
                      where so.customer_id = c.id and sh.ship_date >= $2::date), 0) as ytd,
            (select max(order_date)::text from sales_orders so where so.customer_id = c.id) as last_order
     from customers c where c.organization_id = $1 order by c.name`,
    [ctx.orgId, yearStart],
  );
  return rows.map((r) => ({ ...r, openOrders: num(r.open_orders), ar: num(r.ar), ytd: num(r.ytd), creditLimit: r.credit_limit === null ? null : num(r.credit_limit) }));
}
