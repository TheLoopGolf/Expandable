"use server";

import { runAction } from "@/server/actions";
import { approveSuggestions, dismissSuggestion, runMrpPlanning } from "@/server/services/planning";

export async function runMrpAction(horizonDays: number, siteId: string | null) {
  return runAction((u, db) => runMrpPlanning(db, u.ctx, { horizonDays, siteId }), {
    success: (r) => `${r.number} complete: ${r.summary.suggestions} suggestions (${r.summary.late} late)`,
  });
}
export async function approveSuggestionsAction(ids: string[]) {
  return runAction((u, db) => approveSuggestions(db, u.ctx, ids), {
    success: (r) => `Created ${r.created.map((c) => c.number).join(", ")} as drafts — review and approve/release them`,
  });
}
export async function dismissSuggestionAction(id: string) {
  return runAction((u, db) => dismissSuggestion(db, u.ctx, id), { success: "Suggestion dismissed" });
}
