import { z } from "zod";
import type { Database, Sql } from "../db";
import { authorize, today, type ServiceContext } from "../context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { addDays } from "@/lib/dates";
import { add, cmp, dec, div, max, min, mul, neg, sub, toStr } from "@/lib/decimal";
import { grossComponentQty } from "@/lib/domain/bom";
import { recordAudit } from "./audit";
import { withIdempotency } from "./idempotency";
import { postJournal } from "./journal";
import { nextNumber } from "./numbering";
import {
  assertBin,
  availability,
  closeReservations,
  getReservation,
  loadItem,
  loadWarehouse,
  pickStock,
  postMovement,
  setReservation,
  upsertLot,
} from "./inventory-core";
import { isoDate, optionalText, positiveQty, qty, uuid } from "./schemas";

export const workOrderInput = z.object({
  itemId: uuid,
  quantity: positiveQty,
  plannedStart: isoDate,
  dueDate: isoDate,
  warehouseId: uuid.optional().nullable(),
  materialWarehouseId: uuid.optional().nullable(),
  workCenterId: uuid.optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  salesOrderLineId: uuid.optional().nullable(),
  notes: optionalText,
  source: z.enum(["manual", "mrp"]).default("manual"),
  release: z.boolean().optional(),
});

interface WoRow {
  id: string;
  wo_number: string;
  item_id: string;
  status: string;
  site_id: string;
  warehouse_id: string;
  material_warehouse_id: string;
  quantity_planned: string;
  quantity_completed: string;
  quantity_scrapped: string;
  hold_reason: string | null;
  actual_start: string | null;
  estimated_unit_cost: string;
}

async function loadWo(tx: Sql, ctx: ServiceContext, id: string): Promise<WoRow> {
  const [wo] = await tx.query<WoRow>(
    `select id, wo_number, item_id, status, site_id, warehouse_id, material_warehouse_id, quantity_planned,
            quantity_completed, quantity_scrapped, hold_reason, actual_start, estimated_unit_cost
     from work_orders where id = $1 and organization_id = $2 for update`,
    [id, ctx.orgId],
  );
  if (!wo) throw new NotFoundError("Work order");
  return wo;
}

export async function createWorkOrder(db: Database, ctx: ServiceContext, raw: z.input<typeof workOrderInput>) {
  authorize(ctx, "production.manage");
  const input = workOrderInput.parse(raw);
  return db.transaction(async (tx) => {
    const created = await createWorkOrderTx(tx, ctx, input);
    if (input.release) await releaseWorkOrderTx(tx, ctx, created.id);
    return created;
  });
}

export async function createWorkOrderTx(tx: Sql, ctx: ServiceContext, input: z.output<typeof workOrderInput>) {
  const item = await loadItem(tx, ctx, input.itemId);
  if (item.item_type !== "manufactured") throw new ValidationError(`${item.sku} is a purchased item; work orders need a manufactured item.`);
  if (item.lifecycle_status === "obsolete") throw new ValidationError(`${item.sku} is obsolete.`);
  if (input.dueDate < input.plannedStart) throw new ValidationError("Due date must be on or after the planned start.", { dueDate: "Before start" });

  const [bom] = await tx.query<{ id: string; revision: string }>(
    `select id, revision from boms where item_id = $1 and organization_id = $2 and status = 'released'`,
    [item.id, ctx.orgId],
  );
  if (!bom) throw new ValidationError(`${item.sku} has no released BOM revision. Release a BOM before creating work orders.`);
  const lines = await tx.query<{ line_no: number; component_item_id: string; sku: string; name: string; uom: string; quantity_per: string; scrap_pct: string; standard_cost: string }>(
    `select bl.line_no, bl.component_item_id, i.sku, i.name, i.uom, bl.quantity_per, bl.scrap_pct, i.standard_cost
     from bom_lines bl join items i on i.id = bl.component_item_id
     where bl.bom_id = $1 order by bl.line_no`,
    [bom.id],
  );
  if (lines.length === 0) throw new ValidationError(`BOM ${item.sku} rev ${bom.revision} has no components.`);

  const outputWh = input.warehouseId ?? item.default_warehouse_id;
  if (!outputWh) throw new ValidationError("Choose an output warehouse.", { warehouseId: "Required" });
  const wh = await loadWarehouse(tx, ctx, outputWh);
  const [defaultStores] = await tx.query<{ id: string }>(
    `select id from warehouses where organization_id = $1 and site_id = $2 and kind = 'stores' and is_active order by code limit 1`,
    [ctx.orgId, wh.site_id],
  );
  const materialWhId = input.materialWarehouseId ?? defaultStores?.id ?? wh.id;
  await loadWarehouse(tx, ctx, materialWhId);

  const routing = await tx.query<{ seq: number; work_center_id: string; description: string; setup_hours: string; run_hours_per_unit: string; hourly_rate: string; site_id: string }>(
    `select r.seq, r.work_center_id, r.description, r.setup_hours, r.run_hours_per_unit, wc.hourly_rate, wc.site_id
     from routing_operations r join work_centers wc on wc.id = r.work_center_id
     where r.item_id = $1 and r.organization_id = $2 order by r.seq`,
    [item.id, ctx.orgId],
  );
  let workCenterId: string | null = input.workCenterId ?? routing[0]?.work_center_id ?? null;
  if (workCenterId) {
    const [wc] = await tx.query(`select 1 from work_centers where id = $1 and organization_id = $2`, [workCenterId, ctx.orgId]);
    if (!wc) workCenterId = null;
  }
  if (input.salesOrderLineId) {
    const [sol] = await tx.query(`select 1 from sales_order_lines where id = $1 and organization_id = $2 and item_id = $3`, [input.salesOrderLineId, ctx.orgId, item.id]);
    if (!sol) throw new ValidationError("The linked sales order line is for a different item.");
  }

  const planned = dec(input.quantity);
  let materialPerUnit = 0n;
  for (const l of lines) materialPerUnit = add(materialPerUnit, mul(grossComponentQty(dec(1), dec(l.quantity_per), dec(l.scrap_pct)), dec(l.standard_cost)));
  let laborTotal = 0n;
  for (const op of routing) {
    const hours = add(dec(op.setup_hours), mul(dec(op.run_hours_per_unit), planned));
    laborTotal = add(laborTotal, mul(hours, dec(op.hourly_rate)));
  }
  const estimatedUnitCost = add(materialPerUnit, div(laborTotal, planned));

  const number = await nextNumber(tx, ctx.orgId, "WO");
  const snapshot = {
    bomId: bom.id,
    revision: bom.revision,
    capturedAt: ctx.now().toISOString(),
    lines: lines.map((l) => ({ lineNo: l.line_no, componentItemId: l.component_item_id, sku: l.sku, name: l.name, uom: l.uom, quantityPer: l.quantity_per, scrapPct: l.scrap_pct })),
  };
  const [wo] = await tx.query<{ id: string }>(
    `insert into work_orders (organization_id, wo_number, item_id, bom_id, bom_revision, bom_snapshot, site_id, warehouse_id,
       material_warehouse_id, work_center_id, quantity_planned, status, priority, planned_start, due_date,
       sales_order_line_id, source, estimated_unit_cost, notes, created_by, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::numeric,'draft',$12,$13,$14,$15,$16,$17::numeric,$18,$19,$20,$20)
     returning id`,
    [
      ctx.orgId, number, item.id, bom.id, bom.revision, JSON.stringify(snapshot), wh.site_id, wh.id, materialWhId, workCenterId,
      toStr(planned), input.priority, input.plannedStart, input.dueDate, input.salesOrderLineId ?? null, input.source,
      toStr(estimatedUnitCost), input.notes ?? null, ctx.userId, ctx.now(),
    ],
  );
  for (const l of lines) {
    const required = grossComponentQty(planned, dec(l.quantity_per), dec(l.scrap_pct));
    await tx.query(
      `insert into work_order_materials (organization_id, work_order_id, line_no, component_item_id, quantity_per, scrap_pct, quantity_required, unit_cost)
       values ($1,$2,$3,$4,$5::numeric,$6::numeric,$7::numeric,$8::numeric)`,
      [ctx.orgId, wo.id, l.line_no, l.component_item_id, l.quantity_per, l.scrap_pct, toStr(required), l.standard_cost],
    );
  }
  for (const op of routing) {
    await tx.query(
      `insert into work_order_operations (organization_id, work_order_id, seq, work_center_id, description, planned_hours)
       values ($1,$2,$3,$4,$5,$6::numeric)`,
      [ctx.orgId, wo.id, op.seq, op.work_center_id, op.description, toStr(add(dec(op.setup_hours), mul(dec(op.run_hours_per_unit), planned)), 2)],
    );
  }
  await recordAudit(tx, ctx, {
    action: "work_order.created",
    entityType: "work_order",
    entityId: wo.id,
    entityNumber: number,
    summary: `Created ${number}: ${toStr(planned, 0)} × ${item.sku} due ${input.dueDate} (BOM rev ${bom.revision})`,
    after: { status: "draft", quantity: toStr(planned), bomRevision: bom.revision },
    siteId: wh.site_id,
  });
  return { id: wo.id, number };
}

export async function releaseWorkOrder(db: Database, ctx: ServiceContext, woId: string) {
  authorize(ctx, "production.manage");
  return db.transaction((tx) => releaseWorkOrderTx(tx, ctx, woId));
}

/** Release: freeze the order for execution and allocate available material. */
export async function releaseWorkOrderTx(tx: Sql, ctx: ServiceContext, woId: string) {
  const wo = await loadWo(tx, ctx, woId);
  if (wo.status !== "draft") throw new ConflictError(`${wo.wo_number} is ${wo.status.replace("_", " ")}; only drafts can be released.`);
  await tx.query(`update work_orders set status = 'released', released_by = $2, released_at = $3, updated_at = $3 where id = $1`, [wo.id, ctx.userId, ctx.now()]);
  const allocation = await allocateMaterials(tx, ctx, wo);
  await recordAudit(tx, ctx, {
    action: "work_order.released",
    entityType: "work_order",
    entityId: wo.id,
    entityNumber: wo.wo_number,
    summary: `Released ${wo.wo_number}; ${allocation.fullyAllocated}/${allocation.lines} material lines fully allocated`,
    before: { status: "draft" },
    after: { status: "released" },
    metadata: allocation,
    siteId: wo.site_id,
  });
  return { id: wo.id, number: wo.wo_number, ...allocation };
}

async function allocateMaterials(tx: Sql, ctx: ServiceContext, wo: WoRow) {
  const mats = await tx.query<{ id: string; component_item_id: string; quantity_required: string; quantity_issued: string }>(
    `select id, component_item_id, quantity_required, quantity_issued from work_order_materials where work_order_id = $1 order by line_no`,
    [wo.id],
  );
  let fullyAllocated = 0;
  const shortages: { itemId: string; short: string }[] = [];
  for (const m of mats) {
    const remaining = max(sub(dec(m.quantity_required), dec(m.quantity_issued)), 0n);
    const existing = (await getReservation(tx, ctx, "work_order_material", m.id))?.quantity ?? 0n;
    const avail = await availability(tx, ctx, m.component_item_id, wo.material_warehouse_id);
    const forThis = max(add(avail.available, existing), 0n);
    const allocate = min(remaining, forThis);
    await setReservation(tx, ctx, { itemId: m.component_item_id, warehouseId: wo.material_warehouse_id, demandType: "work_order_material", demandId: m.id, quantity: allocate });
    if (cmp(allocate, remaining) >= 0) fullyAllocated++;
    else shortages.push({ itemId: m.component_item_id, short: toStr(sub(remaining, allocate)) });
  }
  return { lines: mats.length, fullyAllocated, shortages };
}

export interface MaterialReadiness {
  materialId: string;
  lineNo: number;
  itemId: string;
  sku: string;
  name: string;
  uom: string;
  tracking: string;
  quantityPer: string;
  required: string;
  issued: string;
  remaining: string;
  allocated: string;
  usableOnHand: string;
  heldOnHand: string;
  availableForOrder: string;
  shortage: string;
  status: "issued" | "ready" | "partial" | "short" | "blocked";
  note: string;
}

/** Material readiness from the frozen BOM snapshot, live stock, holds and other commitments. */
export async function materialReadiness(tx: Sql, ctx: ServiceContext, woId: string): Promise<MaterialReadiness[]> {
  const asOf = today(ctx);
  const rows = await tx.query<{
    id: string; line_no: number; component_item_id: string; sku: string; name: string; uom: string; tracking: string;
    quantity_per: string; quantity_required: string; quantity_issued: string; allocated: string; usable: string; held: string; reserved_all: string;
  }>(
    `select m.id, m.line_no, m.component_item_id, i.sku, i.name, i.uom, i.tracking, m.quantity_per, m.quantity_required, m.quantity_issued,
       coalesce((select r.quantity from inventory_reservations r where r.demand_type = 'work_order_material' and r.demand_id = m.id and r.status = 'open'), 0) as allocated,
       coalesce((select sum(b.qty_on_hand) from inventory_balances b left join inventory_lots l on l.id = b.lot_id
                 where b.item_id = m.component_item_id and b.warehouse_id = wo.material_warehouse_id
                   and (l.id is null or (l.status = 'available' and (l.expires_on is null or l.expires_on >= $3::date)))), 0) as usable,
       coalesce((select sum(b.qty_on_hand) from inventory_balances b join inventory_lots l on l.id = b.lot_id
                 where b.item_id = m.component_item_id and b.warehouse_id = wo.material_warehouse_id
                   and (l.status <> 'available' or (l.expires_on is not null and l.expires_on < $3::date))), 0) as held,
       coalesce((select sum(r.quantity) from inventory_reservations r where r.item_id = m.component_item_id
                 and r.warehouse_id = wo.material_warehouse_id and r.status = 'open'), 0) as reserved_all
     from work_order_materials m
     join work_orders wo on wo.id = m.work_order_id
     join items i on i.id = m.component_item_id
     where m.work_order_id = $1 and m.organization_id = $2
     order by m.line_no`,
    [woId, ctx.orgId, asOf],
  );
  return rows.map((r) => {
    const remaining = max(sub(dec(r.quantity_required), dec(r.quantity_issued)), 0n);
    const allocated = dec(r.allocated);
    const forOrder = max(add(sub(dec(r.usable), dec(r.reserved_all)), allocated), 0n);
    const shortage = max(sub(remaining, forOrder), 0n);
    const held = dec(r.held);
    let status: MaterialReadiness["status"];
    let note: string;
    if (remaining === 0n) {
      status = "issued";
      note = "Fully issued";
    } else if (shortage === 0n) {
      status = "ready";
      note = cmp(allocated, remaining) >= 0 ? "Allocated and ready to issue" : "Stock available";
    } else if (held > 0n && cmp(add(forOrder, held), remaining) >= 0) {
      status = "blocked";
      note = `${toStr(held, 2)} on quality hold/quarantine; release the hold or use other lots`;
    } else if (forOrder > 0n) {
      status = "partial";
      note = `Short ${toStr(shortage, 2)}; partial issue possible`;
    } else {
      status = "short";
      note = `Short ${toStr(shortage, 2)}; no usable stock`;
    }
    return {
      materialId: r.id,
      lineNo: r.line_no,
      itemId: r.component_item_id,
      sku: r.sku,
      name: r.name,
      uom: r.uom,
      tracking: r.tracking,
      quantityPer: r.quantity_per,
      required: r.quantity_required,
      issued: r.quantity_issued,
      remaining: toStr(remaining),
      allocated: toStr(allocated),
      usableOnHand: r.usable,
      heldOnHand: toStr(held),
      availableForOrder: toStr(forOrder),
      shortage: toStr(shortage),
      status,
      note,
    };
  });
}

export const issueInput = z.object({
  workOrderId: uuid,
  idempotencyKey: z.string().trim().min(8).max(100),
  lines: z
    .array(z.object({ materialId: uuid, quantity: positiveQty, lotId: uuid.optional().nullable() }))
    .min(1, "Enter at least one quantity to issue"),
});

/**
 * Issue components to a work order in one transaction. Lots on hold, quarantined or
 * expired are never issued; stock committed to other orders cannot be taken.
 */
export async function issueMaterials(db: Database, ctx: ServiceContext, raw: z.input<typeof issueInput>) {
  authorize(ctx, "production.execute");
  const input = issueInput.parse(raw);
  return db.transaction((tx) =>
    withIdempotency(tx, ctx, input.idempotencyKey, "production.issue", input, async () => {
      const wo = await loadWo(tx, ctx, input.workOrderId);
      if (wo.status === "on_hold") throw new ConflictError(`${wo.wo_number} is on hold (${wo.hold_reason ?? "no reason"}); resume it before issuing.`);
      if (!["released", "in_progress"].includes(wo.status)) {
        throw new ConflictError(`${wo.wo_number} is ${wo.status.replace("_", " ")}; release it before issuing material.`);
      }
      let value = 0n;
      const issued: { sku: string; quantity: string; lots: string[] }[] = [];
      for (const line of input.lines) {
        const [m] = await tx.query<{ id: string; line_no: number; component_item_id: string; quantity_required: string; quantity_issued: string }>(
          `select id, line_no, component_item_id, quantity_required, quantity_issued from work_order_materials
           where id = $1 and work_order_id = $2 and organization_id = $3 for update`,
          [line.materialId, wo.id, ctx.orgId],
        );
        if (!m) throw new NotFoundError("Work order material line");
        const item = await loadItem(tx, ctx, m.component_item_id);
        const q = dec(line.quantity);
        const remaining = sub(dec(m.quantity_required), dec(m.quantity_issued));
        if (cmp(q, remaining) > 0) {
          throw new ValidationError(`${item.sku}: cannot issue ${toStr(q, 2)}; only ${toStr(max(remaining, 0n), 2)} remains to issue.`);
        }
        const own = (await getReservation(tx, ctx, "work_order_material", m.id))?.quantity ?? 0n;
        const avail = await availability(tx, ctx, item.id, wo.material_warehouse_id);
        const forThis = add(avail.available, own);
        if (cmp(q, forThis) > 0 && line.lotId == null) {
          // Fall through to pickStock for a precise message when the shortfall is due to holds.
          if (cmp(q, avail.usable) <= 0) {
            throw new ValidationError(`${item.sku}: ${toStr(max(forThis, 0n), 2)} available for this order; the rest is committed to other orders.`);
          }
        }
        const picks = await pickStock(tx, ctx, {
          itemId: item.id,
          warehouseId: wo.material_warehouse_id,
          quantity: q,
          lotId: line.lotId,
          purpose: `issue ${item.sku} to ${wo.wo_number}`,
        });
        const cost = dec(item.standard_cost);
        for (const p of picks) {
          const movementId = await postMovement(tx, ctx, {
            type: "issue", itemId: item.id, warehouseId: wo.material_warehouse_id, binId: p.binId, lotId: p.lotId,
            quantity: neg(p.quantity), unitCost: cost, referenceType: "work_order", referenceId: wo.id, referenceNumber: wo.wo_number,
          });
          await tx.query(
            `insert into material_issues (organization_id, work_order_id, work_order_material_id, item_id, warehouse_id, bin_id, lot_id,
               quantity, unit_cost, movement_id, issued_by, issued_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,$10,$11,$12)`,
            [ctx.orgId, wo.id, m.id, item.id, wo.material_warehouse_id, p.binId, p.lotId, toStr(p.quantity), toStr(cost), movementId, ctx.userId, ctx.now()],
          );
        }
        await tx.query(`update work_order_materials set quantity_issued = quantity_issued + $2::numeric where id = $1`, [m.id, toStr(q)]);
        await setReservation(tx, ctx, { itemId: item.id, warehouseId: wo.material_warehouse_id, demandType: "work_order_material", demandId: m.id, quantity: max(sub(own, q), 0n) });
        value = add(value, mul(q, cost));
        issued.push({ sku: item.sku, quantity: toStr(q), lots: picks.map((p) => p.lotNumber).filter((x): x is string => !!x) });
      }
      const newStatus = wo.status === "released" ? "in_progress" : wo.status;
      await tx.query(
        `update work_orders set status = $2, actual_start = coalesce(actual_start, $3), updated_at = $3 where id = $1`,
        [wo.id, newStatus, ctx.now()],
      );
      await postJournal(tx, ctx, {
        description: `${wo.wo_number} material issue`,
        sourceType: "work_order",
        sourceId: wo.id,
        lines: [
          { account: "1350", amount: value },
          { account: "1300", amount: neg(value) },
        ],
      });
      await recordAudit(tx, ctx, {
        action: "work_order.material_issued",
        entityType: "work_order",
        entityId: wo.id,
        entityNumber: wo.wo_number,
        summary: `Issued ${issued.map((i) => `${i.quantity.replace(/\.?0+$/, "")} × ${i.sku}${i.lots.length ? ` [${i.lots.join(", ")}]` : ""}`).join(", ")} to ${wo.wo_number}`,
        before: { status: wo.status },
        after: { status: newStatus },
        metadata: { issued },
        siteId: wo.site_id,
      });
      return { id: wo.id, number: wo.wo_number, status: newStatus, issued };
    }),
  );
}

export const productionInput = z.object({
  workOrderId: uuid,
  quantityGood: qty,
  quantityScrap: qty.default("0"),
  lotNumber: optionalText,
  binId: uuid.optional().nullable(),
  notes: optionalText,
  idempotencyKey: z.string().trim().min(8).max(100),
});

/**
 * Record good output and scrap. Output can never exceed the planned quantity and is
 * limited by the material actually issued (per-unit BOM requirement).
 */
export async function recordProduction(db: Database, ctx: ServiceContext, raw: z.input<typeof productionInput>) {
  authorize(ctx, "production.execute");
  const input = productionInput.parse(raw);
  const good = dec(input.quantityGood);
  const scrap = dec(input.quantityScrap);
  if (good + scrap <= 0n) throw new ValidationError("Enter a good or scrap quantity.", { quantityGood: "Required" });
  return db.transaction((tx) =>
    withIdempotency(tx, ctx, input.idempotencyKey, "production.record", input, async () => {
      const wo = await loadWo(tx, ctx, input.workOrderId);
      if (wo.status === "on_hold") throw new ConflictError(`${wo.wo_number} is on hold; resume it before recording output.`);
      if (!["released", "in_progress"].includes(wo.status)) throw new ConflictError(`${wo.wo_number} is ${wo.status.replace("_", " ")}; output cannot be recorded.`);
      const item = await loadItem(tx, ctx, wo.item_id);
      const planned = dec(wo.quantity_planned);
      const doneBefore = add(dec(wo.quantity_completed), dec(wo.quantity_scrapped));
      const doneAfter = add(doneBefore, good, scrap);
      if (cmp(doneAfter, planned) > 0) {
        throw new ValidationError(
          `Cannot record ${toStr(good + scrap, 2)} units: only ${toStr(sub(planned, doneBefore), 2)} of ${toStr(planned, 2)} remain on ${wo.wo_number}.`,
        );
      }
      const mats = await tx.query<{ sku: string; quantity_required: string; quantity_issued: string; unit_cost: string }>(
        `select i.sku, m.quantity_required, m.quantity_issued, m.unit_cost from work_order_materials m join items i on i.id = m.component_item_id
         where m.work_order_id = $1 order by m.line_no`,
        [wo.id],
      );
      let materialPerUnit = 0n;
      for (const m of mats) {
        const required = dec(m.quantity_required);
        const needed = div(mul(required, doneAfter), planned);
        if (cmp(dec(m.quantity_issued), sub(needed, 1n)) < 0) {
          throw new ValidationError(
            `Not enough ${m.sku} issued: ${toStr(needed, 2)} needed for ${toStr(doneAfter, 2)} units, ${toStr(dec(m.quantity_issued), 2)} issued. Issue material first.`,
          );
        }
        materialPerUnit = add(materialPerUnit, mul(div(required, planned), dec(m.unit_cost)));
      }
      const outWh = await loadWarehouse(tx, ctx, wo.warehouse_id);
      await assertBin(tx, ctx, outWh.id, input.binId);
      const std = dec(item.standard_cost);
      let lotNumber: string | null = null;
      let movementId: string | null = null;
      let lotId: string | null = null;
      if (good > 0n) {
        if (item.tracking !== "none") {
          const [{ n }] = await tx.query<{ n: number }>(`select count(*) as n from production_receipts where work_order_id = $1 and quantity_good > 0`, [wo.id]);
          lotNumber = input.lotNumber ?? `${wo.wo_number.replace("WO-", "FG")}-${String(Number(n) + 1).padStart(2, "0")}`;
          const lot = await upsertLot(tx, ctx, {
            itemId: item.id,
            lotNumber,
            origin: "production",
            originRef: wo.wo_number,
            manufacturedOn: today(ctx),
            expiresOn: item.shelf_life_days ? addDays(today(ctx), item.shelf_life_days) : null,
          });
          lotId = lot.id;
        }
        movementId = await postMovement(tx, ctx, {
          type: "production_receipt", itemId: item.id, warehouseId: outWh.id, binId: input.binId ?? null, lotId,
          quantity: good, unitCost: std, referenceType: "work_order", referenceId: wo.id, referenceNumber: wo.wo_number,
        });
      }
      await tx.query(
        `insert into production_receipts (organization_id, work_order_id, item_id, warehouse_id, bin_id, lot_id, quantity_good,
           quantity_scrap, unit_cost, movement_id, notes, recorded_by, recorded_at)
         values ($1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric,$9::numeric,$10,$11,$12,$13)`,
        [ctx.orgId, wo.id, item.id, outWh.id, input.binId ?? null, lotId, toStr(good), toStr(scrap), toStr(std), movementId, input.notes ?? null, ctx.userId, ctx.now()],
      );
      const completed = cmp(doneAfter, planned) >= 0;
      const newStatus = completed ? "completed" : "in_progress";
      await tx.query(
        `update work_orders set quantity_completed = quantity_completed + $2::numeric, quantity_scrapped = quantity_scrapped + $3::numeric,
           status = $4, actual_start = coalesce(actual_start, $5), actual_end = case when $4 = 'completed' then $5 else actual_end end,
           completed_at = case when $4 = 'completed' then $5 else completed_at end, updated_at = $5
         where id = $1`,
        [wo.id, toStr(good), toStr(scrap), newStatus, ctx.now()],
      );
      if (completed) {
        const ids = await tx.query<{ id: string }>(`select id from work_order_materials where work_order_id = $1`, [wo.id]);
        await closeReservations(tx, ctx, "work_order_material", ids.map((r) => r.id));
        await tx.query(`update work_order_operations set status = 'done', completed_at = coalesce(completed_at, $2) where work_order_id = $1`, [wo.id, ctx.now()]);
      }
      const labor = max(sub(std, materialPerUnit), 0n);
      await postJournal(tx, ctx, {
        description: `${wo.wo_number} production receipt`,
        sourceType: "work_order",
        sourceId: wo.id,
        lines: [
          { account: "1300", amount: mul(good, std), memo: "Finished goods at standard" },
          { account: "5200", amount: mul(scrap, materialPerUnit), memo: "Scrapped material" },
          { account: "5400", amount: neg(mul(good, labor)), memo: "Applied labor and overhead" },
          { account: "1350", amount: neg(add(mul(good, materialPerUnit), mul(scrap, materialPerUnit))), memo: "Relieve WIP" },
        ],
      });
      await recordAudit(tx, ctx, {
        action: "work_order.production_recorded",
        entityType: "work_order",
        entityId: wo.id,
        entityNumber: wo.wo_number,
        summary: `Recorded ${toStr(good, 0)} good${scrap > 0n ? ` and ${toStr(scrap, 0)} scrap` : ""} on ${wo.wo_number} (${item.sku})${lotNumber ? ` → lot ${lotNumber}` : ""}`,
        before: { status: wo.status, completed: wo.quantity_completed, scrapped: wo.quantity_scrapped },
        after: { status: newStatus, completed: toStr(add(dec(wo.quantity_completed), good)), scrapped: toStr(add(dec(wo.quantity_scrapped), scrap)) },
        siteId: wo.site_id,
      });
      return { id: wo.id, number: wo.wo_number, status: newStatus, lotNumber };
    }),
  );
}

export async function holdWorkOrder(db: Database, ctx: ServiceContext, woId: string, reason: string) {
  authorize(ctx, "production.manage");
  if (!reason?.trim()) throw new ValidationError("Give a reason for the hold.", { reason: "Required" });
  return db.transaction(async (tx) => {
    const wo = await loadWo(tx, ctx, woId);
    if (!["released", "in_progress"].includes(wo.status)) throw new ConflictError(`${wo.wo_number} is ${wo.status.replace("_", " ")} and cannot be put on hold.`);
    await tx.query(`update work_orders set status = 'on_hold', hold_reason = $2, updated_at = $3 where id = $1`, [wo.id, reason.trim(), ctx.now()]);
    await recordAudit(tx, ctx, {
      action: "work_order.held",
      entityType: "work_order",
      entityId: wo.id,
      entityNumber: wo.wo_number,
      summary: `Put ${wo.wo_number} on hold: ${reason.trim()}`,
      before: { status: wo.status },
      after: { status: "on_hold", holdReason: reason.trim() },
      siteId: wo.site_id,
    });
    return { id: wo.id };
  });
}

export async function resumeWorkOrder(db: Database, ctx: ServiceContext, woId: string) {
  authorize(ctx, "production.manage");
  return db.transaction(async (tx) => {
    const wo = await loadWo(tx, ctx, woId);
    if (wo.status !== "on_hold") throw new ConflictError(`${wo.wo_number} is not on hold.`);
    const [{ any_issued }] = await tx.query<{ any_issued: boolean }>(
      `select exists(select 1 from material_issues where work_order_id = $1) or $2::numeric > 0 as any_issued`,
      [wo.id, wo.quantity_completed],
    );
    const next = any_issued ? "in_progress" : "released";
    await tx.query(`update work_orders set status = $2, hold_reason = null, updated_at = $3 where id = $1`, [wo.id, next, ctx.now()]);
    await recordAudit(tx, ctx, {
      action: "work_order.resumed",
      entityType: "work_order",
      entityId: wo.id,
      entityNumber: wo.wo_number,
      summary: `Resumed ${wo.wo_number}`,
      before: { status: "on_hold", holdReason: wo.hold_reason },
      after: { status: next },
      siteId: wo.site_id,
    });
    return { id: wo.id, status: next };
  });
}

/** Close a completed order, or short-close an in-process one with a reason. Posts WIP variance. */
export async function closeWorkOrder(db: Database, ctx: ServiceContext, woId: string, reason?: string) {
  authorize(ctx, "production.manage");
  return db.transaction(async (tx) => {
    const wo = await loadWo(tx, ctx, woId);
    if (!["completed", "in_progress", "released"].includes(wo.status)) {
      throw new ConflictError(`${wo.wo_number} is ${wo.status.replace("_", " ")} and cannot be closed.`);
    }
    if (wo.status !== "completed" && !reason?.trim()) {
      throw new ValidationError(`${wo.wo_number} is not complete; give a reason to short-close it.`, { reason: "Required" });
    }
    const ids = await tx.query<{ id: string }>(`select id from work_order_materials where work_order_id = $1`, [wo.id]);
    await closeReservations(tx, ctx, "work_order_material", ids.map((r) => r.id));
    const [wip] = await tx.query<{ balance: string }>(
      `select coalesce(sum(jl.debit - jl.credit), 0) as balance
       from journal_lines jl join journal_entries je on je.id = jl.journal_entry_id
       join accounts a on a.id = jl.account_id
       where je.organization_id = $1 and je.source_type = 'work_order' and je.source_id = $2 and a.code = '1350'`,
      [ctx.orgId, wo.id],
    );
    const balance = dec(wip.balance);
    await postJournal(tx, ctx, {
      description: `${wo.wo_number} close — WIP variance`,
      sourceType: "work_order",
      sourceId: wo.id,
      lines: [
        { account: "5450", amount: balance },
        { account: "1350", amount: neg(balance) },
      ],
    });
    await tx.query(
      `update work_orders set status = 'closed', closed_at = $2, actual_end = coalesce(actual_end, $2), updated_at = $2 where id = $1`,
      [wo.id, ctx.now()],
    );
    await recordAudit(tx, ctx, {
      action: "work_order.closed",
      entityType: "work_order",
      entityId: wo.id,
      entityNumber: wo.wo_number,
      summary: `Closed ${wo.wo_number}${reason?.trim() ? ` (short-close: ${reason.trim()})` : ""}; WIP variance $${toStr(balance, 2)}`,
      before: { status: wo.status },
      after: { status: "closed" },
      siteId: wo.site_id,
    });
    return { id: wo.id };
  });
}

export async function cancelWorkOrder(db: Database, ctx: ServiceContext, woId: string, reason: string) {
  authorize(ctx, "production.manage");
  if (!reason?.trim()) throw new ValidationError("Give a reason for canceling.", { reason: "Required" });
  return db.transaction(async (tx) => {
    const wo = await loadWo(tx, ctx, woId);
    if (!["draft", "released", "on_hold"].includes(wo.status)) throw new ConflictError(`${wo.wo_number} is ${wo.status.replace("_", " ")} and cannot be canceled.`);
    const [issued] = await tx.query(`select 1 from material_issues where work_order_id = $1 limit 1`, [wo.id]);
    if (issued) throw new ConflictError(`${wo.wo_number} already has material issued; close it instead of canceling.`);
    const ids = await tx.query<{ id: string }>(`select id from work_order_materials where work_order_id = $1`, [wo.id]);
    await closeReservations(tx, ctx, "work_order_material", ids.map((r) => r.id));
    await tx.query(`update work_orders set status = 'canceled', updated_at = $2 where id = $1`, [wo.id, ctx.now()]);
    await recordAudit(tx, ctx, {
      action: "work_order.canceled",
      entityType: "work_order",
      entityId: wo.id,
      entityNumber: wo.wo_number,
      summary: `Canceled ${wo.wo_number}: ${reason.trim()}`,
      before: { status: wo.status },
      after: { status: "canceled" },
      siteId: wo.site_id,
    });
    return { id: wo.id };
  });
}

export async function reallocateWorkOrder(db: Database, ctx: ServiceContext, woId: string) {
  authorize(ctx, "production.manage");
  return db.transaction(async (tx) => {
    const wo = await loadWo(tx, ctx, woId);
    if (!["released", "in_progress", "on_hold"].includes(wo.status)) throw new ConflictError("Only open work orders hold allocations.");
    const result = await allocateMaterials(tx, ctx, wo);
    await recordAudit(tx, ctx, {
      action: "work_order.reallocated",
      entityType: "work_order",
      entityId: wo.id,
      entityNumber: wo.wo_number,
      summary: `Re-ran material allocation for ${wo.wo_number}: ${result.fullyAllocated}/${result.lines} lines fully allocated`,
      siteId: wo.site_id,
    });
    return result;
  });
}

export async function completeOperation(db: Database, ctx: ServiceContext, operationId: string) {
  authorize(ctx, "production.execute");
  return db.transaction(async (tx) => {
    const [op] = await tx.query<{ id: string; seq: number; status: string; work_order_id: string; description: string; wo_number: string; wo_status: string; site_id: string }>(
      `select o.id, o.seq, o.status, o.work_order_id, o.description, wo.wo_number, wo.status as wo_status, wo.site_id
       from work_order_operations o join work_orders wo on wo.id = o.work_order_id
       where o.id = $1 and o.organization_id = $2 for update of o`,
      [operationId, ctx.orgId],
    );
    if (!op) throw new NotFoundError("Operation");
    if (op.status === "done") throw new ConflictError("Operation is already done.");
    if (!["released", "in_progress"].includes(op.wo_status)) throw new ConflictError(`${op.wo_number} is ${op.wo_status.replace("_", " ")}.`);
    await tx.query(`update work_order_operations set status = 'done', completed_at = $2 where id = $1`, [op.id, ctx.now()]);
    await tx.query(`update work_orders set status = 'in_progress', actual_start = coalesce(actual_start, $2), updated_at = $2 where id = $1 and status = 'released'`, [op.work_order_id, ctx.now()]);
    await recordAudit(tx, ctx, {
      action: "work_order.operation_completed",
      entityType: "work_order",
      entityId: op.work_order_id,
      entityNumber: op.wo_number,
      summary: `Completed operation ${op.seq} (${op.description}) on ${op.wo_number}`,
      siteId: op.site_id,
    });
    return { id: op.id };
  });
}

