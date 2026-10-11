import type { Sql } from "../db";
import { authorize, type ServiceContext } from "../context";
import { NotFoundError } from "../errors";
import { dec, num } from "@/lib/decimal";
import { whereUsed, type BomMap } from "@/lib/domain/bom";
import { getActivity, getShortages } from "./dashboard";

/** Item master with stock positions (on hand, held, reserved, allocated, available, incoming). */
export async function listItems(db: Sql, ctx: ServiceContext, siteId: string | null, today: string) {
  authorize(ctx, "inventory.view");
  const rows = await db.query<{
    id: string; sku: string; name: string; item_type: string; category: string; product_family: string | null; uom: string; revision: string; lifecycle_status: string;
    standard_cost: string; tracking: string; lead_time_days: number; reorder_point: string; safety_stock: string; supplier: string | null;
    on_hand: string; held: string; reserved: string; allocated: string; incoming: string;
  }>(
    `with bal as (
       select b.item_id, sum(b.qty_on_hand) as on_hand,
              sum(b.qty_on_hand) filter (where l.id is not null and (l.status <> 'available' or (l.expires_on is not null and l.expires_on < $3::date))) as held
       from inventory_balances b join warehouses w on w.id = b.warehouse_id left join inventory_lots l on l.id = b.lot_id
       where b.organization_id = $1 and ($2::uuid is null or w.site_id = $2::uuid) group by 1),
     res as (
       select r.item_id, sum(r.quantity) filter (where r.demand_type = 'sales_order_line') as reserved,
              sum(r.quantity) filter (where r.demand_type = 'work_order_material') as allocated
       from inventory_reservations r join warehouses w on w.id = r.warehouse_id
       where r.organization_id = $1 and r.status = 'open' and ($2::uuid is null or w.site_id = $2::uuid) group by 1),
     inc as (
       select item_id, sum(q) as q from (
         select l.item_id, l.quantity_ordered - l.quantity_received as q from purchase_order_lines l join purchase_orders po on po.id = l.purchase_order_id
         join warehouses w on w.id = po.warehouse_id
         where po.organization_id = $1 and po.status in ('approved','partially_received') and ($2::uuid is null or w.site_id = $2::uuid)
         union all
         select wo.item_id, wo.quantity_planned - wo.quantity_completed - wo.quantity_scrapped from work_orders wo
         where wo.organization_id = $1 and wo.status in ('released','in_progress','on_hold') and ($2::uuid is null or wo.site_id = $2::uuid)) x group by 1)
     select i.id, i.sku, i.name, i.item_type, i.category, i.product_family, i.uom, i.revision, i.lifecycle_status, i.standard_cost, i.tracking, i.lead_time_days,
            i.reorder_point, i.safety_stock, s.name as supplier,
            coalesce(bal.on_hand, 0) as on_hand, coalesce(bal.held, 0) as held, coalesce(res.reserved, 0) as reserved, coalesce(res.allocated, 0) as allocated,
            coalesce(inc.q, 0) as incoming
     from items i left join suppliers s on s.id = i.preferred_supplier_id
     left join bal on bal.item_id = i.id left join res on res.item_id = i.id left join inc on inc.item_id = i.id
     where i.organization_id = $1 order by i.sku`,
    [ctx.orgId, siteId, today],
  );
  const shortages = await getShortages(db, ctx, { siteId, today, family: null });
  const shortageItems = new Map<string, boolean>();
  for (const s of shortages) shortageItems.set(s.itemId, (shortageItems.get(s.itemId) ?? false) || s.critical);
  return rows.map((r) => {
    const onHand = num(r.on_hand);
    const held = num(r.held);
    const reserved = num(r.reserved);
    const allocated = num(r.allocated);
    const available = onHand - held - reserved - allocated;
    const usable = onHand - held;
    const flags: string[] = [];
    if (shortageItems.has(r.id)) flags.push(shortageItems.get(r.id) ? "critical" : "shortage");
    if (num(r.safety_stock) > 0 && usable < num(r.safety_stock)) flags.push("below_safety");
    if (held > 0) flags.push("held");
    return {
      id: r.id,
      sku: r.sku,
      name: r.name,
      type: r.item_type,
      category: r.category,
      family: r.product_family ?? "",
      uom: r.uom,
      revision: r.revision,
      lifecycle: r.lifecycle_status,
      tracking: r.tracking,
      cost: num(r.standard_cost),
      supplier: r.supplier ?? "",
      leadTime: r.lead_time_days,
      reorderPoint: num(r.reorder_point),
      safetyStock: num(r.safety_stock),
      onHand,
      held,
      reserved,
      allocated,
      available,
      incoming: num(r.incoming),
      value: onHand * num(r.standard_cost),
      flags,
      alert: flags.length ? (flags.includes("critical") || flags.includes("shortage") ? "shortage" : flags[0]) : "none",
    };
  });
}

export async function getItem(db: Sql, ctx: ServiceContext, id: string, today: string) {
  authorize(ctx, "inventory.view");
  const [item] = await db.query<Record<string, unknown> & { id: string; sku: string; name: string; item_type: string; tracking: string; standard_cost: string; supplier_name: string | null; default_wh: string | null }>(
    `select i.*, s.name as supplier_name, w.code as default_wh from items i left join suppliers s on s.id = i.preferred_supplier_id
     left join warehouses w on w.id = i.default_warehouse_id where i.id = $1 and i.organization_id = $2`,
    [id, ctx.orgId],
  );
  if (!item) throw new NotFoundError("Item");
  const balances = await db.query<{ warehouse_id: string; wh: string; bin: string | null; bin_id: string | null; lot_id: string | null; lot_number: string | null; lot_status: string | null; expires_on: string | null; qty: string }>(
    `select b.warehouse_id, w.code as wh, bn.code as bin, b.bin_id, b.lot_id, l.lot_number, l.status as lot_status, l.expires_on::text, b.qty_on_hand as qty
     from inventory_balances b join warehouses w on w.id = b.warehouse_id left join bins bn on bn.id = b.bin_id left join inventory_lots l on l.id = b.lot_id
     where b.item_id = $1 and b.organization_id = $2 and b.qty_on_hand > 0 order by w.code, l.expires_on nulls last, l.lot_number`,
    [id, ctx.orgId],
  );
  const movements = await db.query<{ id: string; movement_type: string; quantity: string; unit_cost: string; wh: string; lot_number: string | null; reference_type: string | null; reference_id: string | null; reference_number: string | null; reason: string | null; occurred_at: Date; actor: string | null }>(
    `select m.id, m.movement_type, m.quantity, m.unit_cost, w.code as wh, l.lot_number, m.reference_type, m.reference_id, m.reference_number, m.reason, m.occurred_at, p.full_name as actor
     from inventory_movements m join warehouses w on w.id = m.warehouse_id left join inventory_lots l on l.id = m.lot_id left join profiles p on p.id = m.actor_id
     where m.item_id = $1 and m.organization_id = $2 order by m.occurred_at desc, m.seq desc limit 100`,
    [id, ctx.orgId],
  );
  const supply = await db.query<{ kind: string; id: string; ref: string; date: string; qty: string; status: string }>(
    `select 'PO' as kind, po.id, po.po_number as ref, l.expected_date::text as date, l.quantity_ordered - l.quantity_received as qty, po.status
     from purchase_order_lines l join purchase_orders po on po.id = l.purchase_order_id
     where l.item_id = $1 and po.organization_id = $2 and po.status in ('draft','approved','partially_received') and l.quantity_received < l.quantity_ordered
     union all
     select 'WO', wo.id, wo.wo_number, wo.due_date::text, wo.quantity_planned - wo.quantity_completed - wo.quantity_scrapped, wo.status
     from work_orders wo where wo.item_id = $1 and wo.organization_id = $2 and wo.status in ('draft','released','in_progress','on_hold')
     order by date`,
    [id, ctx.orgId],
  );
  const demand = await db.query<{ kind: string; id: string; ref: string; date: string; qty: string; status: string; reserved: string }>(
    `select 'SO' as kind, so.id, so.so_number as ref, l.promised_date::text as date, l.quantity_ordered - l.quantity_shipped as qty, so.status,
            coalesce((select r.quantity from inventory_reservations r where r.demand_type = 'sales_order_line' and r.demand_id = l.id and r.status = 'open'), 0) as reserved
     from sales_order_lines l join sales_orders so on so.id = l.sales_order_id
     where l.item_id = $1 and so.organization_id = $2 and so.status in ('confirmed','partially_shipped','on_hold','draft') and l.quantity_shipped < l.quantity_ordered
     union all
     select 'WO', wo.id, wo.wo_number, wo.planned_start::text, m.quantity_required - m.quantity_issued, wo.status,
            coalesce((select r.quantity from inventory_reservations r where r.demand_type = 'work_order_material' and r.demand_id = m.id and r.status = 'open'), 0)
     from work_order_materials m join work_orders wo on wo.id = m.work_order_id
     where m.component_item_id = $1 and wo.organization_id = $2 and wo.status in ('draft','released','in_progress','on_hold') and m.quantity_issued < m.quantity_required
     order by date`,
    [id, ctx.orgId],
  );
  const bomRows = await db.query<{ item_id: string; component_item_id: string; quantity_per: string; scrap_pct: string }>(
    `select b.item_id, bl.component_item_id, bl.quantity_per, bl.scrap_pct from boms b join bom_lines bl on bl.bom_id = b.id
     where b.organization_id = $1 and b.status = 'released'`,
    [ctx.orgId],
  );
  const bomMap: BomMap = new Map();
  for (const r of bomRows) {
    const list = bomMap.get(r.item_id) ?? [];
    list.push({ componentItemId: r.component_item_id, quantityPer: dec(r.quantity_per), scrapPct: dec(r.scrap_pct) });
    bomMap.set(r.item_id, list);
  }
  const used = whereUsed(id, bomMap);
  const parents = used.length
    ? await db.query<{ id: string; sku: string; name: string }>(`select id, sku, name from items where id = any($1::uuid[])`, [`{${used.map((u) => u.assemblyId).join(",")}}`])
    : [];
  const [bom] = await db.query<{ id: string; revision: string }>(`select id, revision from boms where item_id = $1 and status = 'released'`, [id]);
  const revisions = await db.query<{ revision: string; status: string; effective_from: string | null; notes: string | null }>(
    `select revision, status, effective_from::text, notes from item_revisions where item_id = $1 order by created_at desc`,
    [id],
  );
  const history = await getActivity(db, ctx, { entityType: "item", entityId: id, limit: 30 });
  const asOf = today;
  return {
    item,
    balances: balances.map((b) => ({ ...b, qty: num(b.qty), blocked: (!!b.lot_status && b.lot_status !== "available") || (!!b.expires_on && b.expires_on < asOf) })),
    movements,
    supply: supply.map((s) => ({ ...s, qty: num(s.qty) })),
    demand: demand.map((d) => ({ ...d, qty: num(d.qty), reserved: num(d.reserved) })),
    whereUsed: used.map((u) => ({ ...u, ...parents.find((p) => p.id === u.assemblyId)! })),
    bom: bom ?? null,
    revisions,
    history,
  };
}

export async function listLots(db: Sql, ctx: ServiceContext, today: string) {
  authorize(ctx, "inventory.view");
  const rows = await db.query<{ id: string; lot_number: string; sku: string; item_id: string; name: string; status: string; expires_on: string | null; received_on: string | null; manufactured_on: string | null; origin: string; origin_ref: string | null; supplier: string | null; qty: string; locations: string | null; hold_id: string | null; hold_reason: string | null; event_id: string | null; event_number: string | null }>(
    `select l.id, l.lot_number, i.sku, i.id as item_id, i.name, l.status, l.expires_on::text, l.received_on::text, l.manufactured_on::text, l.origin, l.origin_ref, s.name as supplier,
            coalesce((select sum(b.qty_on_hand) from inventory_balances b where b.lot_id = l.id), 0) as qty,
            (select string_agg(distinct w.code, ', ') from inventory_balances b join warehouses w on w.id = b.warehouse_id where b.lot_id = l.id and b.qty_on_hand > 0) as locations,
            h.id as hold_id, h.reason as hold_reason, q.id as event_id, q.event_number
     from inventory_lots l join items i on i.id = l.item_id left join suppliers s on s.id = l.supplier_id
     left join quality_holds h on h.lot_id = l.id and h.status = 'active' left join quality_events q on q.id = h.quality_event_id
     where l.organization_id = $1 order by l.created_at desc`,
    [ctx.orgId],
  );
  return rows.map((r) => {
    const expired = !!r.expires_on && r.expires_on < today;
    return { ...r, qty: num(r.qty), expired, state: r.status !== "available" ? r.status : expired ? "expired" : num(r.qty) > 0 ? "available" : "consumed" };
  });
}

/** Lot genealogy: where the lot came from and where it went (issues to WOs, shipments, output lots). */
export async function traceLot(db: Sql, ctx: ServiceContext, lotNumber: string) {
  authorize(ctx, "inventory.view");
  const [lot] = await db.query<{ id: string; lot_number: string; sku: string; item_id: string; origin: string; origin_ref: string | null; status: string }>(
    `select l.id, l.lot_number, i.sku, i.id as item_id, l.origin, l.origin_ref, l.status from inventory_lots l join items i on i.id = l.item_id
     where l.organization_id = $1 and l.lot_number = $2 limit 1`,
    [ctx.orgId, lotNumber],
  );
  if (!lot) return null;
  const consumedBy = await db.query<{ wo_id: string; wo_number: string; sku: string; quantity: string; output_lots: string | null }>(
    `select wo.id as wo_id, wo.wo_number, i.sku, sum(mi.quantity) as quantity,
            (select string_agg(distinct ol.lot_number, ', ') from production_receipts pr join inventory_lots ol on ol.id = pr.lot_id where pr.work_order_id = wo.id) as output_lots
     from material_issues mi join work_orders wo on wo.id = mi.work_order_id join items i on i.id = wo.item_id
     where mi.lot_id = $1 group by wo.id, wo.wo_number, i.sku order by wo.wo_number`,
    [lot.id],
  );
  const shipped = await db.query<{ so_id: string; so_number: string; customer: string; quantity: string; ship_date: string }>(
    `select so.id as so_id, so.so_number, c.name as customer, sum(sl.quantity) as quantity, min(sh.ship_date)::text as ship_date
     from shipment_lines sl join shipments sh on sh.id = sl.shipment_id join sales_orders so on so.id = sh.sales_order_id join customers c on c.id = so.customer_id
     where sl.lot_id = $1 group by so.id, so.so_number, c.name order by ship_date`,
    [lot.id],
  );
  const madeFrom = await db.query<{ sku: string; lot_number: string | null; quantity: string }>(
    `select i.sku, l.lot_number, sum(mi.quantity) as quantity from production_receipts pr join material_issues mi on mi.work_order_id = pr.work_order_id
     join items i on i.id = mi.item_id left join inventory_lots l on l.id = mi.lot_id where pr.lot_id = $1 group by i.sku, l.lot_number order by i.sku`,
    [lot.id],
  );
  const quality = await db.query<{ id: string; event_number: string; title: string; status: string; severity: string }>(
    `select id, event_number, title, status, severity from quality_events where lot_id = $1 order by opened_at`,
    [lot.id],
  );
  return { lot, consumedBy, shipped, madeFrom, quality };
}

export async function listMovements(db: Sql, ctx: ServiceContext, siteId: string | null, from: string, to: string) {
  authorize(ctx, "inventory.view");
  return db.query<{ id: string; seq: number; movement_type: string; sku: string; item_id: string; quantity: string; unit_cost: string; extended_cost: string; wh: string; bin: string | null; lot_number: string | null; reference_type: string | null; reference_id: string | null; reference_number: string | null; reason: string | null; occurred_at: Date; actor: string | null }>(
    `select m.id, m.seq, m.movement_type, i.sku, i.id as item_id, m.quantity, m.unit_cost, m.extended_cost, w.code as wh, bn.code as bin, l.lot_number,
            m.reference_type, m.reference_id, m.reference_number, m.reason, m.occurred_at, p.full_name as actor
     from inventory_movements m join items i on i.id = m.item_id join warehouses w on w.id = m.warehouse_id
     left join bins bn on bn.id = m.bin_id left join inventory_lots l on l.id = m.lot_id left join profiles p on p.id = m.actor_id
     where m.organization_id = $1 and ($2::uuid is null or w.site_id = $2::uuid)
       and (m.occurred_at at time zone $5)::date between $3 and $4
     order by m.occurred_at desc, m.seq desc limit 2000`,
    [ctx.orgId, siteId, from, to, ctx.timezone],
  );
}
