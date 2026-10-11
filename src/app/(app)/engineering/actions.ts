"use server";

import type { z } from "zod";
import { runAction } from "@/server/actions";
import { advanceEngineeringChange, copyBomRevision, createBom, createEngineeringChange, releaseBom, updateBomLines } from "@/server/services/engineering";
import type { bomInput, bomLinesInput, ecoInput } from "@/lib/validation";

export async function createBomAction(input: z.input<typeof bomInput>) {
  return runAction((u, db) => createBom(db, u.ctx, input), { success: "Draft BOM created" });
}
export async function updateBomLinesAction(bomId: string, lines: z.input<typeof bomLinesInput>, notes?: string) {
  return runAction((u, db) => updateBomLines(db, u.ctx, bomId, lines, notes), { success: "BOM saved" });
}
export async function releaseBomAction(bomId: string) {
  return runAction((u, db) => releaseBom(db, u.ctx, bomId), { success: "BOM released; previous revision obsoleted" });
}
export async function copyBomRevisionAction(bomId: string, revision: string) {
  return runAction((u, db) => copyBomRevision(db, u.ctx, bomId, revision), { success: (r) => `Draft revision created` + (r.id ? "" : "") });
}
export async function createEcoAction(input: z.input<typeof ecoInput>) {
  return runAction((u, db) => createEngineeringChange(db, u.ctx, input), { success: (r) => `${r.number} opened${r.bomId ? " with a draft BOM revision" : ""}` });
}
export async function advanceEcoAction(id: string, action: "submit" | "approve" | "reject" | "implement" | "cancel") {
  return runAction((u, db) => advanceEngineeringChange(db, u.ctx, id, action), { success: (r) => `Change is now ${r.status.replace("_", " ")}` });
}
