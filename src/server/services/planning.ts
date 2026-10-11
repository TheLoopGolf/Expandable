import { z } from "zod";
import type { Database, Sql } from "../db";
import { authorize, today, type ServiceContext } from "../context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { addDays, maxDate } from "@/lib/dates";
import { dec, toStr, type Dec } from "@/lib/decimal";
import type { BomMap } from "@/lib/domain/bom";
import { runMrp, type MrpDemand, type MrpItem, type MrpSupply } from "@/lib/domain/mrp";
import { recordAudit } from "./audit";
import { nextNumber } from "./numbering";
import { createPurchaseOrderTx } from "./purchasing";
import { createWorkOrderTx } from "./production";
import { uuid } from "./schemas";

export const mrpRunInput = z.object({
  horizonDays: z.coerce.number().int().min(7).max(365).default(90),
  siteId: uuid.optional().nullable(),
});

/** Gather MRP inputs from live data (optionally limited to one site's warehouses). */
export async function loadMrpInput(tx: Sql, ctx: ServiceContext, siteId?: string | null) {
  const asOf = today(ctx);
  const items = await tx.query<{ id: string; sku: string; name: string; item_type: "purchased" | "manufactured"; lead_time_days: number; safety_stock: string; min_order_qty: string; preferred_supplier_id: string | null }>(
    `select id, sku, name, item_type, lead_time_days, safety_stock, min_order_qty, preferred_supplier_id
     from items where organization_id = $1 and lifecycle_status in ('active','hold')`,
    [ctx.orgId],
  );
  const bomRows = await tx.query<{ item_id: string; component_item_id: string; quantity_per: string; scrap_pct: string }>(
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
  const whFilter = `($2::uuid is null or w.site_id = $2::uuid)`;
  const onHandRows = await tx.query<{ item_id: string; qty: string }>(
    `select b.item_id, sum(b.qty_on_hand) as qty from inventory_balances b
     join warehouses w on w.id = b.warehouse_id
     left join inventory_lots l on l.id = b.lot_id
     where b.organization_id = $1 and ${whFilter}
       and (l.id is null or (l.status = 'available' and (l.expires_on is null or l.expires_on >= $3::date)))
     group by b.item_id`,
    [ctx.orgId, siteId ?? null, asOf],
  );
  const demands: MrpDemand[] = [];
  const soRows = await tx.query<{ item_id: string; date: string; qty: string; ref: string; id: string }>(
    `select l.item_id, l.promised_date as date, l.quantity_ordered - l.quantity_shipped as qty, so.so_number as ref, so.id
     from sales_order_lines l join sales_orders so on so.id = l.sales_order_id join warehouses w on w.id = so.warehouse_id
     where so.organization_id = $1 and ${whFilter} and so.status in ('confirmed','partially_shipped','on_hold')
       and l.quantity_shipped < l.quantity_ordered`,
    [ctx.orgId, siteId ?? null],
  );
  for (const r of soRows) demands.push({ itemId: r.item_id, date: r.date, quantity: dec(r.qty), source: { type: "sales_order", ref: r.ref, id: r.id } });
  const woMatRows = await tx.query<{ item_id: string; date: string; qty: string; ref: string; id: string }>(
    `select m.component_item_id as item_id, wo.planned_start as date, m.quantity_required - m.quantity_issued as qty, wo.wo_number as ref, wo.id
     from work_order_materials m join work_orders wo on wo.id = m.work_order_id join warehouses w on w.id = wo.material_warehouse_id
     where wo.organization_id = $1 and ${whFilter} and wo.status in ('draft','released','in_progress','on_hold')
       and m.quantity_issued < m.quantity_required`,
    [ctx.orgId, siteId ?? null],
  );
  for (const r of woMatRows) demands.push({ itemId: r.item_id, date: r.date, quantity: dec(r.qty), source: { type: "work_order", ref: r.ref, id: r.id } });

  const supplies: MrpSupply[] = [];
  const poRows = await tx.query<{ item_id: string; date: string; qty: string; ref: string; id: string }>(
    `select pol.item_id, pol.expected_date as date, pol.quantity_ordered - pol.quantity_received as qty, po.po_number as ref, po.id
     from purchase_order_lines pol join purchase_orders po on po.id = pol.purchase_order_id join warehouses w on w.id = po.warehouse_id
     where po.organization_id = $1 and ${whFilter} and po.status in ('draft','approved','partially_received')
       and pol.quantity_received < pol.quantity_ordered`,
    [ctx.orgId, siteId ?? null],
  );
  for (const r of poRows) supplies.push({ itemId: r.item_id, date: r.date, quantity: dec(r.qty), source: { type: "purchase_order", ref: r.ref, id: r.id } });
  const woRows = await tx.query<{ item_id: string; date: string; qty: string; ref: string; id: string }>(
    `select wo.item_id, wo.due_date as date, wo.quantity_planned - wo.quantity_completed - wo.quantity_scrapped as qty, wo.wo_number as ref, wo.id
     from work_orders wo join warehouses w on w.id = wo.warehouse_id
     where wo.organization_id = $1 and ${whFilter} and wo.status in ('draft','released','in_progress','on_hold')
       and wo.quantity_planned > wo.quantity_completed + wo.quantity_scrapped`,
    [ctx.orgId, siteId ?? null],
  );
  for (const r of woRows) supplies.push({ itemId: r.item_id, date: r.date, quantity: dec(r.qty), source: { type: "work_order", ref: r.ref, id: r.id } });

  const mrpItems: MrpItem[] = items.map((i) => ({
    id: i.id,
    sku: i.sku,
    name: i.name,
    itemType: i.item_type,
    leadTimeDays: i.lead_time_days,
    safetyStock: dec(i.safety_stock),
    minOrderQty: dec(i.min_order_qty),
    supplierId: i.preferred_supplier_id,
  }));
  return { today: asOf, items: mrpItems, bomMap, onHand: new Map<string, Dec>(onHandRows.map((r) => [r.item_id, dec(r.qty)])), demands, supplies };
}

export async function runMrpPlanning(db: Database, ctx: ServiceContext, raw: z.input<typeof mrpRunInput>) {
  authorize(ctx, "planning.run");
  const input = mrpRunInput.parse(raw);
  return db.transaction(async (tx) => {
    const startedAt = ctx.now();
    const data = await loadMrpInput(tx, ctx, input.siteId);
    const result = runMrp({ ...data, horizonDays: input.horizonDays });
    const number = await nextNumber(tx, ctx.orgId, "MRP");
    const summary = {
      itemsPlanned: result.itemsPlanned,
      suggestions: result.planned.length,
      purchase: result.planned.filter((p) => p.type === "purchase").length,
      manufacture: result.planned.filter((p) => p.type === "manufacture").length,
      late: result.planned.filter((p) => p.isLate).length,
      demands: data.demands.length,
      supplies: data.supplies.length,
    };
    const [run] = await tx.query<{ id: string }>(
      `insert into mrp_runs (organization_id, run_number, status, horizon_days, site_id, parameters, summary, started_at, completed_at, created_by)
       values ($1,$2,'completed',$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9) returning id`,
      [ctx.orgId, number, input.horizonDays, input.siteId ?? null, JSON.stringify({ lotSizing: "lot-for-lot with MOQ", safetyStock: true }), JSON.stringify(summary), startedAt, ctx.now(), ctx.userId],
    );
    await tx.query(
      `update mrp_suggestions set status = 'dismissed', decided_at = $2 where organization_id = $1 and status = 'open'`,
      [ctx.orgId, ctx.now()],
    );
    for (const p of result.planned) {
      await tx.query(
        `insert into mrp_suggestions (organization_id, mrp_run_id, suggestion_type, item_id, supplier_id, quantity, need_date, release_date,
           is_late, explanation, pegging, created_at)
         values ($1,$2,$3,$4,$5,$6::numeric,$7,$8,$9,$10,$11::jsonb,$12)`,
        [ctx.orgId, run.id, p.type, p.itemId, p.supplierId, toStr(p.quantity), p.needDate, p.releaseDate, p.isLate, p.explanation, JSON.stringify(p.pegging), ctx.now()],
      );
    }
    await recordAudit(tx, ctx, {
      action: "mrp.run",
      entityType: "mrp_run",
      entityId: run.id,
      entityNumber: number,
      summary: `Ran ${number} (${input.horizonDays}-day horizon): ${summary.suggestions} suggestions, ${summary.late} late`,
      metadata: summary,
      siteId: input.siteId ?? null,
    });
    return { id: run.id, number, summary };
  });
}

/** Approve suggestions: purchases become draft POs grouped by supplier, manufacture becomes draft WOs. */
export async function approveSuggestions(db: Database, ctx: ServiceContext, suggestionIds: string[]) {
  authorize(ctx, "planning.approve");
  const ids = z.array(uuid).min(1, "Select at least one suggestion").parse(suggestionIds);
  return db.transaction(async (tx) => {
    const asOf = today(ctx);
    const rows = await tx.query<{
      id: string; suggestion_type: "purchase" | "manufacture"; item_id: string; supplier_id: string | null; quantity: string;
      need_date: string; release_date: string; status: string; sku: string; standard_cost: string; lead_time_days: number;
      default_warehouse_id: string | null; default_wh_site: string | null; run_site_id: string | null;
    }>(
      `select s.id, s.suggestion_type, s.item_id, s.supplier_id, s.quantity, s.need_date, s.release_date, s.status, i.sku, i.standard_cost,
              i.lead_time_days, i.default_warehouse_id, dw.site_id as default_wh_site, r.site_id as run_site_id
       from mrp_suggestions s join items i on i.id = s.item_id join mrp_runs r on r.id = s.mrp_run_id
       left join warehouses dw on dw.id = i.default_warehouse_id
       where s.organization_id = $1 and s.id = any($2::uuid[]) for update of s`,
      [ctx.orgId, `{${ids.join(",")}}`],
    );
    if (rows.length !== ids.length) throw new NotFoundError("MRP suggestion");
    const notOpen = rows.find((r) => r.status !== "open");
    if (notOpen) throw new ConflictError(`Suggestion for ${notOpen.sku} is already ${notOpen.status}.`);
    const warehouses = await tx.query<{ id: string; site_id: string; kind: string }>(
      `select id, site_id, kind from warehouses where organization_id = $1 and is_active
       order by case kind when 'stores' then 0 when 'general' then 1 else 2 end, code`,
      [ctx.orgId],
    );
    /** Receiving/output warehouse: the item's default when it fits the run's site, else the site's stores. */
    const targetWarehouse = (r: (typeof rows)[number], purpose: "purchase" | "output"): string | undefined => {
      if (r.default_warehouse_id && (!r.run_site_id || r.default_wh_site === r.run_site_id)) return r.default_warehouse_id;
      const site = r.run_site_id ?? r.default_wh_site;
      const candidates = warehouses.filter((w) => !site || w.site_id === site);
      if (purpose === "output") return (candidates.find((w) => w.kind !== "stores") ?? candidates[0])?.id;
      return candidates[0]?.id;
    };
    const created: { type: string; number: string }[] = [];

    const purchases = rows.filter((r) => r.suggestion_type === "purchase");
    const bySupplier = new Map<string, typeof purchases>();
    for (const p of purchases) {
      if (!p.supplier_id) throw new ValidationError(`${p.sku} has no preferred supplier; set one on the item before approving.`);
      const key = `${p.supplier_id}:${targetWarehouse(p, "purchase")}`;
      bySupplier.set(key, [...(bySupplier.get(key) ?? []), p]);
    }
    for (const [key, group] of bySupplier) {
      const [supplierId, warehouseId] = key.split(":");
      if (!warehouseId || warehouseId === "undefined") throw new ValidationError("No stores warehouse available for purchase suggestions.");
      const lines = group.map((g) => ({
        itemId: g.item_id,
        quantity: g.quantity,
        unitCost: g.standard_cost,
        expectedDate: maxDate(g.need_date, addDays(asOf, g.lead_time_days)),
      }));
      const expected = lines.map((l) => l.expectedDate).sort()[0];
      const po = await createPurchaseOrderTx(tx, ctx, {
        supplierId,
        warehouseId,
        expectedDate: expected,
        notes: "Created from MRP suggestions",
        source: "mrp",
        lines,
      });
      for (const g of group) {
        await tx.query(
          `update mrp_suggestions set status = 'approved', decided_by = $2, decided_at = $3, created_document_type = 'purchase_order',
             created_document_id = $4, created_document_number = $5 where id = $1`,
          [g.id, ctx.userId, ctx.now(), po.id, po.number],
        );
      }
      created.push({ type: "purchase_order", number: po.number });
    }
    for (const m of rows.filter((r) => r.suggestion_type === "manufacture")) {
      const start = maxDate(m.release_date, asOf);
      const wo = await createWorkOrderTx(tx, ctx, {
        itemId: m.item_id,
        quantity: m.quantity,
        plannedStart: start,
        dueDate: maxDate(m.need_date, start),
        warehouseId: targetWarehouse(m, "output"),
        priority: m.release_date < asOf ? "high" : "normal",
        notes: "Created from MRP suggestion",
        source: "mrp",
      });
      await tx.query(
        `update mrp_suggestions set status = 'approved', decided_by = $2, decided_at = $3, created_document_type = 'work_order',
           created_document_id = $4, created_document_number = $5 where id = $1`,
        [m.id, ctx.userId, ctx.now(), wo.id, wo.number],
      );
      created.push({ type: "work_order", number: wo.number });
    }
    await recordAudit(tx, ctx, {
      action: "mrp.suggestions_approved",
      entityType: "mrp_run",
      summary: `Approved ${rows.length} MRP suggestion${rows.length === 1 ? "" : "s"} → ${created.map((c) => c.number).join(", ")} (drafts, pending approval/release)`,
      metadata: { created },
    });
    return { created };
  });
}

export async function dismissSuggestion(db: Database, ctx: ServiceContext, suggestionId: string) {
  authorize(ctx, "planning.approve");
  return db.transaction(async (tx) => {
    const [s] = await tx.query<{ id: string; status: string }>(
      `select id, status from mrp_suggestions where id = $1 and organization_id = $2 for update`,
      [suggestionId, ctx.orgId],
    );
    if (!s) throw new NotFoundError("MRP suggestion");
    if (s.status !== "open") throw new ConflictError("Suggestion is no longer open.");
    await tx.query(`update mrp_suggestions set status = 'dismissed', decided_by = $2, decided_at = $3 where id = $1`, [s.id, ctx.userId, ctx.now()]);
    return { id: s.id };
  });
}
