import type { Sql } from "../db";
import type { ServiceContext } from "../context";

/** Small option lists for forms and filters (org-scoped). */
export async function warehouseOptions(db: Sql, ctx: ServiceContext) {
  return db.query<{ id: string; code: string; name: string; site_id: string; kind: string }>(
    `select id, code, name, site_id, kind from warehouses where organization_id = $1 and is_active order by code`,
    [ctx.orgId],
  );
}

export async function binOptions(db: Sql, ctx: ServiceContext) {
  return db.query<{ id: string; code: string; warehouse_id: string }>(
    `select id, code, warehouse_id from bins where organization_id = $1 order by code`,
    [ctx.orgId],
  );
}

export async function itemOptions(db: Sql, ctx: ServiceContext, type?: "purchased" | "manufactured") {
  return db.query<{ id: string; sku: string; name: string; uom: string; tracking: string; item_type: string; standard_cost: string; list_price: string | null; preferred_supplier_id: string | null; default_warehouse_id: string | null; lead_time_days: number }>(
    `select id, sku, name, uom, tracking, item_type, standard_cost, list_price, preferred_supplier_id, default_warehouse_id, lead_time_days
     from items where organization_id = $1 and lifecycle_status in ('active','draft') and ($2::text is null or item_type = $2::text) order by sku`,
    [ctx.orgId, type ?? null],
  );
}

export async function supplierOptions(db: Sql, ctx: ServiceContext) {
  return db.query<{ id: string; code: string; name: string; default_lead_time_days: number }>(
    `select id, code, name, default_lead_time_days from suppliers where organization_id = $1 and is_active order by name`,
    [ctx.orgId],
  );
}

export async function customerOptions(db: Sql, ctx: ServiceContext) {
  return db.query<{ id: string; code: string; name: string }>(
    `select id, code, name from customers where organization_id = $1 and is_active order by name`,
    [ctx.orgId],
  );
}

export async function workCenterOptions(db: Sql, ctx: ServiceContext) {
  return db.query<{ id: string; code: string; name: string; site_id: string }>(
    `select id, code, name, site_id from work_centers where organization_id = $1 and is_active order by code`,
    [ctx.orgId],
  );
}

export async function memberOptions(db: Sql, ctx: ServiceContext) {
  return db.query<{ id: string; full_name: string; role_key: string }>(
    `select p.id, p.full_name, m.role_key from memberships m join profiles p on p.id = m.profile_id
     where m.organization_id = $1 and m.is_active order by p.full_name`,
    [ctx.orgId],
  );
}

export async function lotOptions(db: Sql, ctx: ServiceContext) {
  return db.query<{ id: string; lot_number: string; item_id: string; sku: string; status: string; qty: string }>(
    `select l.id, l.lot_number, l.item_id, i.sku, l.status, coalesce(sum(b.qty_on_hand), 0) as qty
     from inventory_lots l join items i on i.id = l.item_id left join inventory_balances b on b.lot_id = l.id
     where l.organization_id = $1 group by l.id, l.lot_number, l.item_id, i.sku, l.status
     having coalesce(sum(b.qty_on_hand), 0) > 0 order by i.sku, l.lot_number`,
    [ctx.orgId],
  );
}
