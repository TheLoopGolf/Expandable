"use server";

import type { z } from "zod";
import { runAction } from "@/server/actions";
import { countAdjust, createItem, issueStock, receiveStock, transferStock, updateItem } from "@/server/services/inventory";
import { placeLotHold, releaseLotHold, releaseQuarantine } from "@/server/services/quality";
import type { countInput, holdInput, itemInput, miscIssueInput, miscReceiptInput, releaseHoldInput, transferInput } from "@/lib/validation";

export async function receiveStockAction(input: z.input<typeof miscReceiptInput>) {
  // Opening balances are a seed/import concern; never accepted from the UI.
  return runAction((u, db) => receiveStock(db, u.ctx, { ...input, opening: false }), { success: (r) => `Receipt ${r.reference} posted` });
}
export async function issueStockAction(input: z.input<typeof miscIssueInput>) {
  return runAction((u, db) => issueStock(db, u.ctx, input), { success: (r) => `Issue ${r.reference} posted` });
}
export async function transferStockAction(input: z.input<typeof transferInput>) {
  return runAction((u, db) => transferStock(db, u.ctx, input), { success: (r) => `Transfer ${r.reference} posted` });
}
export async function countAdjustAction(input: z.input<typeof countInput>) {
  return runAction((u, db) => countAdjust(db, u.ctx, input), { success: (r) => `Count adjustment ${r.reference} posted (${Number(r.delta) > 0 ? "+" : ""}${Number(r.delta)})` });
}
export async function createItemAction(input: z.input<typeof itemInput>) {
  return runAction((u, db) => createItem(db, u.ctx, input), { success: "Item created" });
}
export async function updateItemAction(id: string, input: z.input<typeof itemInput>) {
  return runAction((u, db) => updateItem(db, u.ctx, id, input), { success: "Item updated" });
}
export async function placeHoldAction(input: z.input<typeof holdInput>) {
  return runAction((u, db) => placeLotHold(db, u.ctx, input), { success: "Lot placed on quality hold" });
}
export async function releaseHoldAction(holdId: string, reason: string) {
  const input: z.input<typeof releaseHoldInput> = { holdId, reason };
  return runAction((u, db) => releaseLotHold(db, u.ctx, input), { success: "Quality hold released" });
}
export async function placeHoldOnLotAction(lotId: string, reason: string) {
  return runAction((u, db) => placeLotHold(db, u.ctx, { lotId, reason }), { success: "Lot placed on quality hold" });
}
export async function releaseQuarantineAction(lotId: string, reason: string) {
  return runAction((u, db) => releaseQuarantine(db, u.ctx, lotId, reason), { success: "Lot released from quarantine" });
}
