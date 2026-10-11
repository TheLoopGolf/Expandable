"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { config } from "@/server/config";
import { writeDemoSession, writePreference, ORG_COOKIE, SITE_COOKIE } from "@/server/auth/session";

export async function loginAsPersona(profileId: string) {
  if (config.authMode !== "demo") return { ok: false as const, error: "Demo sign-in is disabled. Use your email and password." };
  const id = z.string().uuid().parse(profileId);
  const db = await getDb();
  const [m] = await db.query<{ organization_id: string }>(
    `select m.organization_id from memberships m join organizations o on o.id = m.organization_id
     where m.profile_id = $1 and m.is_active order by o.created_at limit 1`,
    [id],
  );
  if (!m) return { ok: false as const, error: "That persona has no active membership." };
  await writeDemoSession(id);
  await writePreference(ORG_COOKIE, m.organization_id);
  await writePreference(SITE_COOKIE, "all");
  redirect("/dashboard");
}

export async function loginWithPassword(_: unknown, form: FormData) {
  if (config.authMode !== "supabase") return { error: "Password sign-in requires AUTH_MODE=supabase." };
  const parsed = z.object({ email: z.string().email(), password: z.string().min(6) }).safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) return { error: "Enter a valid email and password." };
  const { supabaseServerClient } = await import("@/server/auth/supabase");
  const supabase = await supabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: error.message };
  redirect("/dashboard");
}
