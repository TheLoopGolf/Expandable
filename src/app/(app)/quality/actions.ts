"use server";

import type { z } from "zod";
import { runAction } from "@/server/actions";
import { createCapa, openQualityEvent, recordInspection, updateCapaStatus, updateQualityEvent } from "@/server/services/quality";
import type { capaInput, inspectionInput, qualityEventInput, updateEventInput } from "@/lib/validation";

export async function openQualityEventAction(input: z.input<typeof qualityEventInput>) {
  return runAction((u, db) => openQualityEvent(db, u.ctx, input), { success: (r) => `${r.number} opened${r.holdId ? " and lot placed on hold" : ""}` });
}
export async function updateQualityEventAction(input: z.input<typeof updateEventInput>) {
  return runAction((u, db) => updateQualityEvent(db, u.ctx, input), { success: "Quality event updated" });
}
export async function createCapaAction(input: z.input<typeof capaInput>) {
  return runAction((u, db) => createCapa(db, u.ctx, input), { success: (r) => `${r.number} created` });
}
export async function updateCapaAction(id: string, status: "open" | "in_progress" | "verified" | "closed", notes?: string) {
  return runAction((u, db) => updateCapaStatus(db, u.ctx, id, status, notes), { success: "CAPA updated" });
}
export async function recordInspectionAction(input: z.input<typeof inspectionInput>) {
  return runAction((u, db) => recordInspection(db, u.ctx, input), { success: (r) => `Inspection ${r.number} recorded` });
}
