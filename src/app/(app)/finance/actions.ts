"use server";

import { runAction } from "@/server/actions";
import { issueInvoice, recordCustomerPayment } from "@/server/services/sales";
import { paySupplierBill } from "@/server/services/purchasing";

export async function issueInvoiceAction(id: string) {
  return runAction((u, db) => issueInvoice(db, u.ctx, id), { success: "Invoice issued and posted to AR" });
}
export async function recordPaymentAction(id: string, amount?: string) {
  return runAction((u, db) => recordCustomerPayment(db, u.ctx, id, amount), { success: (r) => (r.paidInFull ? "Payment recorded — invoice paid in full" : "Partial payment recorded") });
}
export async function paySupplierBillAction(id: string) {
  return runAction((u, db) => paySupplierBill(db, u.ctx, id), { success: "Supplier bill paid" });
}
