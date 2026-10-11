"use server";

import { runAction } from "@/server/actions";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  createSupplierBill,
  receivePurchaseOrder,
} from "@/server/services/purchasing";
import type { purchaseOrderInput, receiveInput, supplierInput } from "@/lib/validation";
import type { z } from "zod";

export async function createPurchaseOrderAction(input: z.input<typeof purchaseOrderInput>, approve: boolean) {
  return runAction(
    async (u, db) => {
      const po = await createPurchaseOrder(db, u.ctx, input);
      if (approve) await approvePurchaseOrder(db, u.ctx, po.id);
      return po;
    },
    { success: (r) => `${r.number} created${approve ? " and approved" : " as draft"}` },
  );
}

export async function approvePurchaseOrderAction(id: string) {
  return runAction((u, db) => approvePurchaseOrder(db, u.ctx, id), { success: (r) => `${r.number} approved` });
}

export async function cancelPurchaseOrderAction(id: string, reason: string) {
  return runAction((u, db) => cancelPurchaseOrder(db, u.ctx, id, reason), { success: "Purchase order canceled" });
}

export async function closePurchaseOrderAction(id: string, reason: string) {
  return runAction((u, db) => closePurchaseOrder(db, u.ctx, id, reason), { success: "Purchase order short-closed" });
}

export async function receivePurchaseOrderAction(input: z.input<typeof receiveInput>) {
  return runAction((u, db) => receivePurchaseOrder(db, u.ctx, input), {
    success: (r) => (r.replayed ? `${r.number}: duplicate submission ignored (already received)` : `Received on ${r.number} — now ${r.status.replace("_", " ")}`),
  });
}

export async function createSupplierAction(input: z.input<typeof supplierInput>) {
  return runAction((u, db) => createSupplier(db, u.ctx, input), { success: "Supplier added" });
}

export async function createSupplierBillAction(poId: string) {
  return runAction((u, db) => createSupplierBill(db, u.ctx, poId), { success: (r) => `Supplier bill ${r.number} recorded` });
}
