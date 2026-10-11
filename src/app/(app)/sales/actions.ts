"use server";

import type { z } from "zod";
import { runAction } from "@/server/actions";
import { getCurrentUser } from "@/server/auth/current";
import { getDb } from "@/server/db";
import {
  availableToPromise,
  cancelSalesOrder,
  closeSalesOrder,
  confirmSalesOrder,
  createCustomer,
  createInvoice,
  createSalesOrder,
  releaseSalesOrderReservations,
  reserveSalesOrder,
  shipSalesOrder,
} from "@/server/services/sales";
import { authorize } from "@/server/context";
import type { customerInput, salesOrderInput, shipInput } from "@/lib/validation";

export async function createSalesOrderAction(input: z.input<typeof salesOrderInput>) {
  return runAction((u, db) => createSalesOrder(db, u.ctx, input), { success: (r) => `${r.number} created` });
}
export async function confirmSalesOrderAction(id: string) {
  return runAction((u, db) => confirmSalesOrder(db, u.ctx, id), { success: (r) => `${r.number} confirmed` });
}
export async function reserveSalesOrderAction(id: string) {
  return runAction((u, db) => reserveSalesOrder(db, u.ctx, id), {
    success: (r) => `Reserved: ${r.lines.map((l) => `${l.sku} ${Number(l.reserved)}/${Number(l.open)}`).join(", ")}`,
  });
}
export async function releaseReservationsAction(id: string) {
  return runAction((u, db) => releaseSalesOrderReservations(db, u.ctx, id), { success: "Reservations released" });
}
export async function shipSalesOrderAction(input: z.input<typeof shipInput>) {
  return runAction((u, db) => shipSalesOrder(db, u.ctx, input), {
    success: (r) => (r.replayed ? "Duplicate submission ignored (already shipped)" : `${r.shipmentNumber} confirmed — order ${r.status.replace("_", " ")}${r.invoice ? `; draft ${r.invoice.number} created` : ""}`),
  });
}
export async function createInvoiceAction(soId: string) {
  return runAction((u, db) => createInvoice(db, u.ctx, soId), { success: (r) => `Draft invoice ${r.number} created` });
}
export async function cancelSalesOrderAction(id: string, reason: string) {
  return runAction((u, db) => cancelSalesOrder(db, u.ctx, id, reason), { success: "Sales order canceled" });
}
export async function closeSalesOrderAction(id: string, reason: string) {
  return runAction((u, db) => closeSalesOrder(db, u.ctx, id, reason), { success: "Sales order closed" });
}
export async function createCustomerAction(input: z.input<typeof customerInput>) {
  return runAction((u, db) => createCustomer(db, u.ctx, input), { success: "Customer added" });
}

/** Read-only available-to-promise lookup for order entry. */
export async function atpAction(itemId: string, warehouseId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  authorize(user.ctx, "sales.view");
  const db = await getDb();
  try {
    return await availableToPromise(db, user.ctx, itemId, warehouseId);
  } catch {
    return null;
  }
}
