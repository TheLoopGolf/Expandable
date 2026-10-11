/**
 * Inventory posting primitives shared by every module. All functions must run inside a
 * transaction; balances are row-locked before decrements and the database CHECK
 * constraint is the final guard against negative stock.
 */
import type { Sql } from "../db";
import type { ServiceContext } from "../context";
import { today } from "../context";
import { NotFoundError, ValidationError } from "../errors";
import { add, cmp, dec, min, sub, toStr, type Dec } from "@/lib/decimal";

export type MovementType =
  | "receipt"
  | "issue"
  | "transfer_out"
  | "transfer_in"
  | "adjustment"
  | "production_receipt"
  | "shipment"
  | "scrap"
  | "reversal";

export interface Location {
  itemId: string;
  warehouseId: string;
  binId?: string | null;
  lotId?: string | null;
}

export interface ItemRow {
  id: string;
  sku: string;
  name: string;
  item_type: "purchased" | "manufactured";
  uom: string;
  tracking: "none" | "lot" | "serial";
  standard_cost: string;
  shelf_life_days: number | null;
  lifecycle_status: string;
  default_warehouse_id: string | null;
  preferred_supplier_id: string | null;
  lead_time_days: number;
  revision: string;
  list_price: string | null;
  product_family: string | null;
}

export async function loadItem(tx: Sql, ctx: ServiceContext, itemId: string): Promise<ItemRow> {
  const [item] = await tx.query<ItemRow>(
    `select id, sku, name, item_type, uom, tracking, standard_cost, shelf_life_days, lifecycle_status,
            default_warehouse_id, preferred_supplier_id, lead_time_days, revision, list_price, product_family
     from items where id = $1 and organization_id = $2`,
    [itemId, ctx.orgId],
  );
  if (!item) throw new NotFoundError("Item");
  return item;
}

export async function loadWarehouse(
  tx: Sql,
  ctx: ServiceContext,
  warehouseId: string,
): Promise<{ id: string; code: string; name: string; site_id: string }> {
  const [wh] = await tx.query<{ id: string; code: string; name: string; site_id: string }>(
    `select id, code, name, site_id from warehouses where id = $1 and organization_id = $2 and is_active`,
    [warehouseId, ctx.orgId],
  );
  if (!wh) throw new NotFoundError("Warehouse");
  return wh;
}

export async function assertBin(tx: Sql, ctx: ServiceContext, warehouseId: string, binId?: string | null) {
  if (!binId) return;
  const [bin] = await tx.query(`select id from bins where id = $1 and warehouse_id = $2 and organization_id = $3`, [
    binId,
    warehouseId,
    ctx.orgId,
  ]);
  if (!bin) throw new ValidationError("The selected bin does not belong to the warehouse.");
}

/** Find or create a lot for an item. Lot numbers are unique per item within the org. */
export async function upsertLot(
  tx: Sql,
  ctx: ServiceContext,
  input: {
    itemId: string;
    lotNumber: string;
    origin: "purchase" | "production" | "adjustment" | "opening";
    originRef?: string;
    expiresOn?: string | null;
    manufacturedOn?: string | null;
    supplierId?: string | null;
    status?: "available" | "quarantine";
  },
): Promise<{ id: string; lot_number: string; status: string; created: boolean }> {
  const lotNumber = input.lotNumber.trim();
  if (!lotNumber) throw new ValidationError("A lot number is required for lot-tracked items.");
  const [existing] = await tx.query<{ id: string; lot_number: string; status: string }>(
    `select id, lot_number, status from inventory_lots where organization_id = $1 and item_id = $2 and lot_number = $3`,
    [ctx.orgId, input.itemId, lotNumber],
  );
  if (existing) return { ...existing, created: false };
  const [lot] = await tx.query<{ id: string; lot_number: string; status: string }>(
    `insert into inventory_lots
       (organization_id, item_id, lot_number, status, expires_on, manufactured_on, received_on,
        supplier_id, origin, origin_ref, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     returning id, lot_number, status`,
    [
      ctx.orgId,
      input.itemId,
      lotNumber,
      input.status ?? "available",
      input.expiresOn ?? null,
      input.manufacturedOn ?? null,
      input.origin === "purchase" ? today(ctx) : null,
      input.supplierId ?? null,
      input.origin,
      input.originRef ?? null,
      ctx.now(),
    ],
  );
  return { ...lot, created: true };
}

export interface PostMovementInput extends Location {
  type: MovementType;
  /** Signed: positive increases on-hand, negative decreases it. */
  quantity: Dec;
  unitCost: Dec;
  referenceType?: string;
  referenceId?: string | null;
  referenceNumber?: string | null;
  reason?: string | null;
  reversalOf?: string | null;
}

/** Update the balance row and append the immutable movement. Returns the movement id. */
export async function postMovement(tx: Sql, ctx: ServiceContext, m: PostMovementInput): Promise<string> {
  if (m.quantity === 0n) throw new ValidationError("Quantity must not be zero.");
  if (m.quantity < 0n) {
    const [bal] = await tx.query<{ id: string; qty_on_hand: string }>(
      `select id, qty_on_hand from inventory_balances
       where organization_id = $1 and item_id = $2 and warehouse_id = $3
         and bin_id is not distinct from $4 and lot_id is not distinct from $5
       for update`,
      [ctx.orgId, m.itemId, m.warehouseId, m.binId ?? null, m.lotId ?? null],
    );
    const onHand = dec(bal?.qty_on_hand ?? "0");
    if (!bal || cmp(onHand, -m.quantity) < 0) {
      throw new ValidationError(
        `Insufficient stock at the selected location: ${toStr(onHand)} on hand, ${toStr(-m.quantity)} requested.`,
      );
    }
    await tx.query(`update inventory_balances set qty_on_hand = qty_on_hand + $2::numeric, updated_at = $3 where id = $1`, [
      bal.id,
      toStr(m.quantity),
      ctx.now(),
    ]);
  } else {
    await tx.query(
      `insert into inventory_balances (organization_id, item_id, warehouse_id, bin_id, lot_id, qty_on_hand, updated_at)
       values ($1, $2, $3, $4, $5, $6::numeric, $7)
       on conflict on constraint inventory_balances_location_key
       do update set qty_on_hand = inventory_balances.qty_on_hand + excluded.qty_on_hand,
                     updated_at = excluded.updated_at`,
      [ctx.orgId, m.itemId, m.warehouseId, m.binId ?? null, m.lotId ?? null, toStr(m.quantity), ctx.now()],
    );
  }
  const [mv] = await tx.query<{ id: string }>(
    `insert into inventory_movements
       (organization_id, movement_type, item_id, warehouse_id, bin_id, lot_id, quantity, unit_cost,
        reference_type, reference_id, reference_number, reason, reversal_of, actor_id, occurred_at)
     values ($1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9, $10, $11, $12, $13, $14, $15)
     returning id`,
    [
      ctx.orgId,
      m.type,
      m.itemId,
      m.warehouseId,
      m.binId ?? null,
      m.lotId ?? null,
      toStr(m.quantity),
      toStr(m.unitCost),
      m.referenceType ?? null,
      m.referenceId ?? null,
      m.referenceNumber ?? null,
      m.reason ?? null,
      m.reversalOf ?? null,
      ctx.userId,
      ctx.now(),
    ],
  );
  return mv.id;
}

export interface StockPick {
  binId: string | null;
  lotId: string | null;
  lotNumber: string | null;
  quantity: Dec;
}

interface BalanceCandidate {
  id: string;
  bin_id: string | null;
  lot_id: string | null;
  qty_on_hand: string;
  lot_number: string | null;
  lot_status: string | null;
  expires_on: string | null;
}

/**
 * Choose stock to consume (FEFO: first-expiring, then oldest lot), skipping lots that are
 * on quality hold, quarantined or expired. Locks the candidate balance rows.
 * When `lotId` is given only that lot is used and a blocked lot is rejected outright.
 */
export async function pickStock(
  tx: Sql,
  ctx: ServiceContext,
  input: { itemId: string; warehouseId: string; quantity: Dec; lotId?: string | null; binId?: string | null; purpose: string },
): Promise<StockPick[]> {
  const asOf = today(ctx);
  const rows = await tx.query<BalanceCandidate>(
    `select b.id, b.bin_id, b.lot_id, b.qty_on_hand, l.lot_number, l.status as lot_status, l.expires_on
     from inventory_balances b
     left join inventory_lots l on l.id = b.lot_id
     where b.organization_id = $1 and b.item_id = $2 and b.warehouse_id = $3 and b.qty_on_hand > 0
       and ($4::uuid is null or b.lot_id = $4::uuid)
       and ($5::uuid is null or b.bin_id = $5::uuid)
     order by l.expires_on asc nulls last, l.created_at asc nulls first, b.qty_on_hand asc
     for update of b`,
    [ctx.orgId, input.itemId, input.warehouseId, input.lotId ?? null, input.binId ?? null],
  );

  const blockedReason = (r: BalanceCandidate): string | null => {
    if (r.lot_status === "hold") return `lot ${r.lot_number} is on quality hold`;
    if (r.lot_status === "quarantine") return `lot ${r.lot_number} is quarantined`;
    if (r.expires_on && r.expires_on < asOf) return `lot ${r.lot_number} expired on ${r.expires_on}`;
    return null;
  };

  if (input.lotId) {
    const blocked = rows.map(blockedReason).find(Boolean);
    if (blocked) throw new ValidationError(`Cannot ${input.purpose}: ${blocked}.`);
  }

  let remaining = input.quantity;
  const picks: StockPick[] = [];
  let blockedQty = 0n;
  const blockedNotes = new Set<string>();
  for (const r of rows) {
    const reason = blockedReason(r);
    if (reason) {
      blockedQty = add(blockedQty, dec(r.qty_on_hand));
      blockedNotes.add(reason);
      continue;
    }
    if (remaining <= 0n) break;
    const take = min(remaining, dec(r.qty_on_hand));
    picks.push({ binId: r.bin_id, lotId: r.lot_id, lotNumber: r.lot_number, quantity: take });
    remaining = sub(remaining, take);
  }
  if (remaining > 0n) {
    const usable = sub(input.quantity, remaining);
    const extra =
      blockedQty > 0n
        ? ` ${toStr(blockedQty)} more is blocked (${[...blockedNotes].slice(0, 3).join("; ")}).`
        : "";
    throw new ValidationError(
      `Cannot ${input.purpose}: only ${toStr(usable)} usable on hand, ${toStr(input.quantity)} required.${extra}`,
    );
  }
  return picks;
}

/** Usable (not held/expired) on-hand and open reservations for an item in a warehouse. */
export async function availability(
  tx: Sql,
  ctx: ServiceContext,
  itemId: string,
  warehouseId: string,
): Promise<{ usable: Dec; reserved: Dec; available: Dec }> {
  const asOf = today(ctx);
  const [row] = await tx.query<{ usable: string; reserved: string }>(
    `select
       coalesce((select sum(b.qty_on_hand) from inventory_balances b
                 left join inventory_lots l on l.id = b.lot_id
                 where b.organization_id = $1 and b.item_id = $2 and b.warehouse_id = $3
                   and (l.id is null or (l.status = 'available' and (l.expires_on is null or l.expires_on >= $4::date)))), 0) as usable,
       coalesce((select sum(r.quantity) from inventory_reservations r
                 where r.organization_id = $1 and r.item_id = $2 and r.warehouse_id = $3 and r.status = 'open'), 0) as reserved`,
    [ctx.orgId, itemId, warehouseId, asOf],
  );
  const usable = dec(row.usable);
  const reserved = dec(row.reserved);
  return { usable, reserved, available: sub(usable, reserved) };
}

/** Set (create/replace) the open reservation quantity for a demand line. */
export async function setReservation(
  tx: Sql,
  ctx: ServiceContext,
  input: { itemId: string; warehouseId: string; demandType: "sales_order_line" | "work_order_material"; demandId: string; quantity: Dec },
): Promise<void> {
  const qty = input.quantity < 0n ? 0n : input.quantity;
  await tx.query(
    `insert into inventory_reservations (organization_id, item_id, warehouse_id, demand_type, demand_id, quantity, status, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $8)
     on conflict (demand_type, demand_id, warehouse_id)
     do update set quantity = excluded.quantity, status = excluded.status, updated_at = excluded.updated_at`,
    [ctx.orgId, input.itemId, input.warehouseId, input.demandType, input.demandId, toStr(qty), qty > 0n ? "open" : "closed", ctx.now()],
  );
}

export async function getReservation(
  tx: Sql,
  ctx: ServiceContext,
  demandType: "sales_order_line" | "work_order_material",
  demandId: string,
): Promise<{ quantity: Dec; warehouseId: string } | null> {
  const [row] = await tx.query<{ quantity: string; warehouse_id: string }>(
    `select quantity, warehouse_id from inventory_reservations
     where organization_id = $1 and demand_type = $2 and demand_id = $3 and status = 'open'`,
    [ctx.orgId, demandType, demandId],
  );
  return row ? { quantity: dec(row.quantity), warehouseId: row.warehouse_id } : null;
}

export async function closeReservations(
  tx: Sql,
  ctx: ServiceContext,
  demandType: "sales_order_line" | "work_order_material",
  demandIds: string[],
): Promise<void> {
  for (const id of demandIds) {
    await tx.query(
      `update inventory_reservations set quantity = 0, status = 'closed', updated_at = $4
       where organization_id = $1 and demand_type = $2 and demand_id = $3 and status = 'open'`,
      [ctx.orgId, demandType, id, ctx.now()],
    );
  }
}
