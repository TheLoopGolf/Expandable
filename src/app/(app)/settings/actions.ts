"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/server/actions";
import { getCurrentUser } from "@/server/auth/current";
import { clearSession } from "@/server/auth/session";
import { config } from "@/server/config";
import { can } from "@/server/context";
import { getDb } from "@/server/db";
import { addMember, updateMemberRole, updateOrganization } from "@/server/services/admin";
import { getAuditEvent } from "@/server/queries/settings";
import type { memberInput, orgSettingsInput } from "@/lib/validation";
import type { z } from "zod";

export async function updateOrganizationAction(input: z.input<typeof orgSettingsInput>) {
  return runAction((u, db) => updateOrganization(db, u.ctx, input), { success: "Organization settings saved" });
}

export async function addMemberAction(input: z.input<typeof memberInput>) {
  return runAction((u, db) => addMember(db, u.ctx, input), { success: `${input.fullName} added` });
}

export async function updateMemberAction(profileId: string, role: string, active: boolean) {
  return runAction((u, db) => updateMemberRole(db, u.ctx, profileId, role, active), { success: "Member updated" });
}

export async function auditDetailAction(id: string) {
  return runAction((u, db) => getAuditEvent(db, u.ctx, id));
}

const g = globalThis as unknown as { __forgeflowResetting?: boolean };

/**
 * Wipe and re-seed the demo database. Admin only, and only where the deployment allows it
 * (always for the local PGlite demo; for Postgres only with ALLOW_DEMO_RESET=true).
 * Profile ids change, so the session is cleared and the user signs in again.
 */
export async function resetDemoDataAction(confirmation: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
  if (!can(user.ctx, "admin.manage")) return { ok: false, error: "Only admins can reset demo data." };
  if (!config.allowDemoReset) return { ok: false, error: "Demo reset is disabled for this database (set ALLOW_DEMO_RESET=true to enable it)." };
  if (confirmation.trim() !== "RESET") return { ok: false, error: 'Type RESET to confirm.' };
  if (g.__forgeflowResetting) return { ok: false, error: "A reset is already running." };
  g.__forgeflowResetting = true;
  try {
    const db = await getDb();
    const { truncateAll } = await import("@/server/seed/ensure");
    const { seedDemo } = await import("@/server/seed");
    await truncateAll(db);
    await seedDemo(db, { log: (m) => console.log(`[forgeflow] ${m}`) });
  } catch (err) {
    console.error("[forgeflow] demo reset failed", err);
    return { ok: false, error: "Reset failed; check the server log. Run `npm run db:reset` to rebuild the database." };
  } finally {
    g.__forgeflowResetting = false;
  }
  await clearSession();
  revalidatePath("/", "layout");
  redirect("/login?reset=1");
}
