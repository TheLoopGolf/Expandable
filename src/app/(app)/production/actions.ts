"use server";

import type { z } from "zod";
import { runAction } from "@/server/actions";
import {
  cancelWorkOrder,
  closeWorkOrder,
  completeOperation,
  createWorkOrder,
  holdWorkOrder,
  issueMaterials,
  reallocateWorkOrder,
  recordProduction,
  releaseWorkOrder,
  resumeWorkOrder,
} from "@/server/services/production";
import type { issueInput, productionInput, workOrderInput } from "@/lib/validation";

export async function createWorkOrderAction(input: z.input<typeof workOrderInput>) {
  return runAction((u, db) => createWorkOrder(db, u.ctx, input), { success: (r) => `${r.number} created${input.release ? " and released" : ""}` });
}
export async function releaseWorkOrderAction(id: string) {
  return runAction((u, db) => releaseWorkOrder(db, u.ctx, id), {
    success: (r) => `${r.number} released — ${r.fullyAllocated}/${r.lines} material lines fully allocated`,
  });
}
export async function issueMaterialsAction(input: z.input<typeof issueInput>) {
  return runAction((u, db) => issueMaterials(db, u.ctx, input), {
    success: (r) => (r.replayed ? "Duplicate submission ignored (already issued)" : `Issued ${r.issued.length} material line${r.issued.length === 1 ? "" : "s"} to ${r.number}`),
  });
}
export async function recordProductionAction(input: z.input<typeof productionInput>) {
  return runAction((u, db) => recordProduction(db, u.ctx, input), {
    success: (r) => (r.replayed ? "Duplicate submission ignored" : `Output recorded on ${r.number}${r.lotNumber ? ` (lot ${r.lotNumber})` : ""} — ${r.status.replace("_", " ")}`),
  });
}
export async function holdWorkOrderAction(id: string, reason: string) {
  return runAction((u, db) => holdWorkOrder(db, u.ctx, id, reason), { success: "Work order put on hold" });
}
export async function resumeWorkOrderAction(id: string) {
  return runAction((u, db) => resumeWorkOrder(db, u.ctx, id), { success: "Work order resumed" });
}
export async function closeWorkOrderAction(id: string, reason?: string) {
  return runAction((u, db) => closeWorkOrder(db, u.ctx, id, reason), { success: "Work order closed" });
}
export async function cancelWorkOrderAction(id: string, reason: string) {
  return runAction((u, db) => cancelWorkOrder(db, u.ctx, id, reason), { success: "Work order canceled" });
}
export async function reallocateWorkOrderAction(id: string) {
  return runAction((u, db) => reallocateWorkOrder(db, u.ctx, id), { success: (r) => `Allocation refreshed: ${r.fullyAllocated}/${r.lines} lines fully allocated` });
}
export async function completeOperationAction(id: string) {
  return runAction((u, db) => completeOperation(db, u.ctx, id), { success: "Operation completed" });
}
