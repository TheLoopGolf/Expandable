import { z } from "zod";
import type { Database } from "../db";
import { authorize, today, type ServiceContext } from "../context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { addDays } from "@/lib/dates";
import { dec, mul, neg, sub, toStr } from "@/lib/decimal";
import { recordAudit } from "./audit";
import { withIdempotency } from "./idempotency";
import { postJournal } from "./journal";
import { nextNumber } from "./numbering";
import { assertBin, loadItem, loadWarehouse, pickStock, postMovement, upsertLot } from "./inventory-core";
import { qty, positiveQty, money, optionalText, uuid, isoDate } from "./schemas";

// ---------------------------------------------------------------------------
// Item master
// ---------------------------------------------------------------------------
export const itemInput = z.object({
  sku: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dot, dash or underscore"),
  name: z.string().trim().min(2).max(120),
  description: optionalText,
  itemType: z.enum(["purchased", "manufactured"]),
  category: z.string().trim().min(2).max(60),
  productFamily: optionalText,
  uom: z.string().trim().min(1).max(10).default("ea"),
  standardCost: money,
  listPrice: money.optional().nullable(),
  preferredSupplierId: uuid.optional().nullable(),
  leadTimeDays: z.coerce.number().int().min(0).max(365),
  reorderPoint: qty,
  safetyStock: qty,
  minOrderQty: positiveQty,
  tracking: z.enum(["none", "lot", "serial"]),
  shelfLifeDays: z.coerce.number().int().positive().max(3650).optional().nullable(),
  defaultWarehouseId: uuid.optional().nullable(),
  lifecycleStatus: z.enum(["draft", "active", "hold", "obsolete"]).default("active"),
});
export type ItemInput = z.input<typeof itemInput>;

export async function createItem(db: Database, ctx: ServiceContext, raw: ItemInput) {
  authorize(ctx, "items.manage");
  const input = itemInput.parse(raw);
  return db.transaction(async (tx) => {
    const [dup] = await tx.query(`select 1 from items where organization_id = $1 and lower(sku) = lower($2)`, [ctx.orgId, input.sku]);
    if (dup) throw new ValidationError(`SKU ${input.sku} already exists.`, { sku: "SKU already exists" });
    if (input.preferredSupplierId) {
      const [s] = await tx.query(`select 1 from suppliers where id = $1 and organization_id = $2`, [input.preferredSupplierId, ctx.orgId]);
      if (!s) throw new NotFoundError("Supplier");
    }
    if (input.defaultWarehouseId) await loadWarehouse(tx, ctx, input.defaultWarehouseId);
    const [row] = await tx.query<{ id: string }>(
      `insert into items (organization_id, sku, name, description, item_type, category, product_family, uom,
         standard_cost, list_price, preferred_supplier_id, lead_time_days, reorder_point, safety_stock,
         min_order_qty, tracking, shelf_life_days, default_warehouse_id, lifecycle_status, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10::numeric,$11,$12,$13::numeric,$14::numeric,$15::numeric,$16,$17,$18,$19,$20,$20)
       returning id`,
      [
        ctx.orgId, input.sku.toUpperCase(), input.name, input.description ?? null, input.itemType, input.category,
        input.productFamily ?? null, input.uom, input.standardCost, input.listPrice ?? null, input.preferredSupplierId ?? null,
        input.leadTimeDays, input.reorderPoint, input.safetyStock, input.minOrderQty, input.tracking,
        input.shelfLifeDays ?? null, input.defaultWarehouseId ?? null, input.lifecycleStatus, ctx.now(),
      ],
    );
    await tx.query(
      `insert into item_revisions (organization_id, item_id, revision, status, effective_from, notes)
       values ($1, $2, 'A', 'released', $3, 'Initial revision')`,
      [ctx.orgId, row.id, today(ctx)],
    );
    await recordAudit(tx, ctx, {
      action: "item.created",
      entityType: "item",
      entityId: row.id,
      entityNumber: input.sku.toUpperCase(),
      summary: `Created item ${input.sku.toUpperCase()} — ${input.name}`,
      after: input,
    });
    return { id: row.id };
  });
}

export async function updateItem(db: Database, ctx: ServiceContext, itemId: string, raw: ItemInput) {
  authorize(ctx, "items.manage");
  const input = itemInput.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.query<Record<string, unknown>>(
      `select sku, name, description, item_type, category, product_family, uom, standard_cost, list_price,
              preferred_supplier_id, lead_time_days, reorder_point, safety_stock, min_order_qty, tracking,
              shelf_life_days, default_warehouse_id, lifecycle_status
       from items where id = $1 and organization_id = $2 for update`,
      [itemId, ctx.orgId],
    );
    if (!before) throw new NotFoundError("Item");
    if (String(before.sku).toUpperCase() !== input.sku.toUpperCase()) {
      const [used] = await tx.query(`select 1 from inventory_movements where item_id = $1 limit 1`, [itemId]);
      if (used) throw new ValidationError("SKU cannot change after inventory has been posted.", { sku: "Locked" });
    }
    if (before.tracking !== input.tracking) {
      const [stock] = await tx.query(`select 1 from inventory_balances where item_id = $1 and qty_on_hand > 0 limit 1`, [itemId]);
      if (stock) throw new ValidationError("Tracking policy cannot change while stock is on hand.", { tracking: "Locked" });
    }
    await tx.query(
      `update items set sku = $3, name = $4, description = $5, item_type = $6, category = $7, product_family = $8,
         uom = $9, standard_cost = $10::numeric, list_price = $11::numeric, preferred_supplier_id = $12,
         lead_time_days = $13, reorder_point = $14::numeric, safety_stock = $15::numeric, min_order_qty = $16::numeric,
         tracking = $17, shelf_life_days = $18, default_warehouse_id = $19, lifecycle_status = $20, updated_at = $21
       where id = $1 and organization_id = $2`,
      [
        itemId, ctx.orgId, input.sku.toUpperCase(), input.name, input.description ?? null, input.itemType, input.category,
        input.productFamily ?? null, input.uom, input.standardCost, input.listPrice ?? null, input.preferredSupplierId ?? null,
        input.leadTimeDays, input.reorderPoint, input.safetyStock, input.minOrderQty, input.tracking,
        input.shelfLifeDays ?? null, input.defaultWarehouseId ?? null, input.lifecycleStatus, ctx.now(),
      ],
    );
    await recordAudit(tx, ctx, {
      action: "item.updated",
      entityType: "item",
      entityId: itemId,
      entityNumber: input.sku.toUpperCase(),
      summary: `Updated item ${input.sku.toUpperCase()}`,
      before,
      after: input,
    });
    return { id: itemId };
  });
}

// ---------------------------------------------------------------------------
// Stock transactions (receipt, issue, transfer, cycle count)
// ---------------------------------------------------------------------------
export const miscReceiptInput = z.object({
  itemId: uuid,
  warehouseId: uuid,
  binId: uuid.optional().nullable(),
  quantity: positiveQty,
  lotNumber: optionalText,
  expiresOn: isoDate.optional().nullable(),
  reason: z.string().trim().min(3, "Give a reason").max(200),
  idempotencyKey: optionalText,
  /** Opening balance (credits equity instead of inventory adjustments). Seed/import only. */
  opening: z.boolean().optional(),
});

export async function receiveStock(db: Database, ctx: ServiceContext, raw: z.input<typeof miscReceiptInput>) {
  authorize(ctx, "inventory.transact");
  const input = miscReceiptInput.parse(raw);
  return db.transaction((tx) =>
    withIdempotency(tx, ctx, input.idempotencyKey, "inventory.receipt", input, async () => {
      const item = await loadItem(tx, ctx, input.itemId);
      const wh = await loadWarehouse(tx, ctx, input.warehouseId);
      await assertBin(tx, ctx, wh.id, input.binId);
      let lotId: string | null = null;
      if (item.tracking !== "none") {
        if (!input.lotNumber) throw new ValidationError("Lot number is required for this item.", { lotNumber: "Required" });
        const lot = await upsertLot(tx, ctx, {
          itemId: item.id,
          lotNumber: input.lotNumber,
          origin: input.opening ? "opening" : "adjustment",
          expiresOn: input.expiresOn ?? (item.shelf_life_days ? addDays(today(ctx), item.shelf_life_days) : null),
        });
        lotId = lot.id;
      }
      const ref = await nextNumber(tx, ctx.orgId, "ADJ");
      const q = dec(input.quantity);
      const cost = dec(item.standard_cost);
      const movementId = await postMovement(tx, ctx, {
        type: "receipt",
        itemId: item.id,
        warehouseId: wh.id,
        binId: input.binId,
        lotId,
        quantity: q,
        unitCost: cost,
        referenceType: "adjustment",
        referenceNumber: ref,
        reason: input.reason,
      });
      await postJournal(tx, ctx, {
        description: `${ref} miscellaneous receipt ${item.sku}`,
        sourceType: "inventory_adjustment",
        sourceId: movementId,
        lines: [
          { account: "1300", amount: mul(q, cost) },
          { account: input.opening ? "3000" : "5300", amount: neg(mul(q, cost)) },
        ],
      });
      await recordAudit(tx, ctx, {
        action: "inventory.received",
        entityType: "item",
        entityId: item.id,
        entityNumber: item.sku,
        summary: `Received ${toStr(q, 2)} ${item.uom} of ${item.sku} into ${wh.code} (${ref})`,
        metadata: { reason: input.reason, movementId, lotNumber: input.lotNumber ?? null },
        siteId: wh.site_id,
      });
      return { reference: ref, movementId };
    }),
  );
}

export const miscIssueInput = z.object({
  itemId: uuid,
  warehouseId: uuid,
  binId: uuid.optional().nullable(),
  lotId: uuid.optional().nullable(),
  quantity: positiveQty,
  reason: z.string().trim().min(3, "Give a reason").max(200),
  idempotencyKey: optionalText,
});

export async function issueStock(db: Database, ctx: ServiceContext, raw: z.input<typeof miscIssueInput>) {
  authorize(ctx, "inventory.transact");
  const input = miscIssueInput.parse(raw);
  return db.transaction((tx) =>
    withIdempotency(tx, ctx, input.idempotencyKey, "inventory.issue", input, async () => {
      const item = await loadItem(tx, ctx, input.itemId);
      const wh = await loadWarehouse(tx, ctx, input.warehouseId);
      const q = dec(input.quantity);
      const picks = await pickStock(tx, ctx, {
        itemId: item.id,
        warehouseId: wh.id,
        quantity: q,
        lotId: input.lotId,
        binId: input.binId,
        purpose: `issue ${item.sku}`,
      });
      const ref = await nextNumber(tx, ctx.orgId, "ADJ");
      const cost = dec(item.standard_cost);
      for (const p of picks) {
        await postMovement(tx, ctx, {
          type: "issue",
          itemId: item.id,
          warehouseId: wh.id,
          binId: p.binId,
          lotId: p.lotId,
          quantity: neg(p.quantity),
          unitCost: cost,
          referenceType: "adjustment",
          referenceNumber: ref,
          reason: input.reason,
        });
      }
      await postJournal(tx, ctx, {
        description: `${ref} miscellaneous issue ${item.sku}`,
        sourceType: "inventory_adjustment",
        lines: [
          { account: "5300", amount: mul(q, cost) },
          { account: "1300", amount: neg(mul(q, cost)) },
        ],
      });
      await recordAudit(tx, ctx, {
        action: "inventory.issued",
        entityType: "item",
        entityId: item.id,
        entityNumber: item.sku,
        summary: `Issued ${toStr(q, 2)} ${item.uom} of ${item.sku} from ${wh.code} (${ref})`,
        metadata: { reason: input.reason, picks: picks.map((p) => ({ ...p, quantity: toStr(p.quantity) })) },
        siteId: wh.site_id,
      });
      return { reference: ref };
    }),
  );
}

export const transferInput = z.object({
  itemId: uuid,
  fromWarehouseId: uuid,
  fromBinId: uuid.optional().nullable(),
  lotId: uuid.optional().nullable(),
  toWarehouseId: uuid,
  toBinId: uuid.optional().nullable(),
  quantity: positiveQty,
  reason: optionalText,
  idempotencyKey: optionalText,
});

export async function transferStock(db: Database, ctx: ServiceContext, raw: z.input<typeof transferInput>) {
  authorize(ctx, "inventory.transact");
  const input = transferInput.parse(raw);
  if (input.fromWarehouseId === input.toWarehouseId && (input.fromBinId ?? null) === (input.toBinId ?? null)) {
    throw new ValidationError("Choose a different destination location.");
  }
  return db.transaction((tx) =>
    withIdempotency(tx, ctx, input.idempotencyKey, "inventory.transfer", input, async () => {
      const item = await loadItem(tx, ctx, input.itemId);
      const from = await loadWarehouse(tx, ctx, input.fromWarehouseId);
      const to = await loadWarehouse(tx, ctx, input.toWarehouseId);
      await assertBin(tx, ctx, to.id, input.toBinId);
      const q = dec(input.quantity);
      // Transfers move held stock too only when the lot is explicitly chosen; default picks usable stock.
      const picks = await pickStock(tx, ctx, {
        itemId: item.id,
        warehouseId: from.id,
        quantity: q,
        lotId: input.lotId,
        binId: input.fromBinId,
        purpose: `transfer ${item.sku}`,
      });
      const ref = await nextNumber(tx, ctx.orgId, "TRF");
      const cost = dec(item.standard_cost);
      for (const p of picks) {
        await postMovement(tx, ctx, {
          type: "transfer_out", itemId: item.id, warehouseId: from.id, binId: p.binId, lotId: p.lotId,
          quantity: neg(p.quantity), unitCost: cost, referenceType: "transfer", referenceNumber: ref, reason: input.reason,
        });
        await postMovement(tx, ctx, {
          type: "transfer_in", itemId: item.id, warehouseId: to.id, binId: input.toBinId ?? null, lotId: p.lotId,
          quantity: p.quantity, unitCost: cost, referenceType: "transfer", referenceNumber: ref, reason: input.reason,
        });
      }
      await recordAudit(tx, ctx, {
        action: "inventory.transferred",
        entityType: "item",
        entityId: item.id,
        entityNumber: item.sku,
        summary: `Transferred ${toStr(q, 2)} ${item.uom} of ${item.sku} from ${from.code} to ${to.code} (${ref})`,
        siteId: to.site_id,
      });
      return { reference: ref };
    }),
  );
}

export const countInput = z.object({
  itemId: uuid,
  warehouseId: uuid,
  binId: uuid.optional().nullable(),
  lotId: uuid.optional().nullable(),
  countedQuantity: qty,
  reason: z.string().trim().min(3, "Give a reason").max(200),
  idempotencyKey: optionalText,
});

/** Cycle count: post the difference between counted and system quantity as an adjustment. */
export async function countAdjust(db: Database, ctx: ServiceContext, raw: z.input<typeof countInput>) {
  authorize(ctx, "inventory.transact");
  const input = countInput.parse(raw);
  return db.transaction((tx) =>
    withIdempotency(tx, ctx, input.idempotencyKey, "inventory.count", input, async () => {
      const item = await loadItem(tx, ctx, input.itemId);
      const wh = await loadWarehouse(tx, ctx, input.warehouseId);
      if (item.tracking !== "none" && !input.lotId) {
        throw new ValidationError("Select the lot being counted.", { lotId: "Required" });
      }
      if (input.lotId) {
        const [lot] = await tx.query(`select 1 from inventory_lots where id = $1 and item_id = $2 and organization_id = $3`, [input.lotId, item.id, ctx.orgId]);
        if (!lot) throw new NotFoundError("Lot");
      }
      const [bal] = await tx.query<{ qty_on_hand: string }>(
        `select qty_on_hand from inventory_balances
         where organization_id = $1 and item_id = $2 and warehouse_id = $3
           and bin_id is not distinct from $4 and lot_id is not distinct from $5 for update`,
        [ctx.orgId, item.id, wh.id, input.binId ?? null, input.lotId ?? null],
      );
      const system = dec(bal?.qty_on_hand ?? "0");
      const delta = sub(dec(input.countedQuantity), system);
      if (delta === 0n) {
        throw new ConflictError(`Count matches the system quantity (${toStr(system, 2)}); nothing to adjust.`);
      }
      const ref = await nextNumber(tx, ctx.orgId, "ADJ");
      const cost = dec(item.standard_cost);
      await postMovement(tx, ctx, {
        type: "adjustment", itemId: item.id, warehouseId: wh.id, binId: input.binId, lotId: input.lotId,
        quantity: delta, unitCost: cost, referenceType: "cycle_count", referenceNumber: ref, reason: input.reason,
      });
      await postJournal(tx, ctx, {
        description: `${ref} cycle count ${item.sku}`,
        sourceType: "inventory_adjustment",
        lines: [
          { account: "1300", amount: mul(delta, cost) },
          { account: "5300", amount: neg(mul(delta, cost)) },
        ],
      });
      await recordAudit(tx, ctx, {
        action: "inventory.counted",
        entityType: "item",
        entityId: item.id,
        entityNumber: item.sku,
        summary: `Cycle count ${item.sku} at ${wh.code}: system ${toStr(system, 2)} → counted ${toStr(dec(input.countedQuantity), 2)} (${ref})`,
        before: { quantity: toStr(system) },
        after: { quantity: input.countedQuantity },
        metadata: { reason: input.reason },
        siteId: wh.site_id,
      });
      return { reference: ref, delta: toStr(delta) };
    }),
  );
}
