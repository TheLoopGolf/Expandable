import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import type { ServiceContext } from "../context";
import { resolveFeatures, type Features } from "../services/features";
import { config } from "../config";
import { isRangeKey, resolveRange, todayInTz, type DateRange, type RangeKey } from "@/lib/dates";
import { ROLES, isRoleKey, type Permission, type RoleKey } from "@/lib/permissions";
import { ORG_COOKIE, RANGE_COOKIE, SITE_COOKIE, readDemoSession, readPreference } from "./session";

export interface Membership {
  orgId: string;
  orgName: string;
  role: RoleKey;
}

export interface CurrentUser {
  ctx: ServiceContext;
  user: { id: string; name: string; email: string; title: string | null; role: RoleKey; roleName: string };
  org: { id: string; name: string; timezone: string; isDemo: boolean; seededFor: string | null; features: Features };
  memberships: Membership[];
  sites: { id: string; code: string; name: string }[];
  siteId: string | null;
  range: DateRange;
  today: string;
  permissions: Permission[];
}

async function resolveProfileId(): Promise<string | null> {
  if (config.authMode === "supabase") {
    const { supabaseServerClient } = await import("./supabase");
    const supabase = await supabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    const db = await getDb();
    const [linked] = await db.query<{ id: string }>(`select id from profiles where auth_user_id = $1`, [data.user.id]);
    if (linked) return linked.id;
    if (!data.user.email) return null;
    // First sign-in: link an invited profile by email.
    const [byEmail] = await db.query<{ id: string }>(
      `update profiles set auth_user_id = $1 where lower(email) = lower($2) and auth_user_id is null returning id`,
      [data.user.id, data.user.email],
    );
    return byEmail?.id ?? null;
  }
  return (await readDemoSession())?.pid ?? null;
}

/** The signed-in user and their active organization, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const profileId = await resolveProfileId();
  if (!profileId) return null;
  const db = await getDb();
  const [profile] = await db.query<{ id: string; full_name: string; email: string; title: string | null }>(
    `select id, full_name, email, title from profiles where id = $1`,
    [profileId],
  );
  if (!profile) return null;
  const memberships = await db.query<{ organization_id: string; name: string; role_key: string; timezone: string; is_demo: boolean; settings: Record<string, unknown> }>(
    `select m.organization_id, o.name, m.role_key, o.timezone, o.is_demo, o.settings
     from memberships m join organizations o on o.id = m.organization_id
     where m.profile_id = $1 and m.is_active order by o.created_at`,
    [profileId],
  );
  if (memberships.length === 0) return null;
  const preferred = await readPreference(ORG_COOKIE);
  const active = memberships.find((m) => m.organization_id === preferred) ?? memberships[0];
  const role = isRoleKey(active.role_key) ? active.role_key : "viewer";
  const sites = await db.query<{ id: string; code: string; name: string }>(
    `select id, code, name from sites where organization_id = $1 order by code`,
    [active.organization_id],
  );
  const sitePref = await readPreference(SITE_COOKIE);
  const siteId = sites.some((s) => s.id === sitePref) ? sitePref! : null;
  const rangePref = await readPreference(RANGE_COOKIE);
  const rangeKey: RangeKey = isRangeKey(rangePref) ? rangePref : "90d";
  const today = todayInTz(active.timezone);
  const settings = active.settings ?? {};
  const ctx: ServiceContext = {
    orgId: active.organization_id,
    orgName: active.name,
    userId: profile.id,
    userName: profile.full_name,
    role,
    timezone: active.timezone,
    now: () => new Date(),
  };
  return {
    ctx,
    user: { id: profile.id, name: profile.full_name, email: profile.email, title: profile.title, role, roleName: ROLES[role].name },
    org: {
      id: active.organization_id,
      name: active.name,
      timezone: active.timezone,
      isDemo: active.is_demo,
      seededFor: typeof settings.seededFor === "string" ? settings.seededFor : null,
      features: resolveFeatures(settings.features),
    },
    memberships: memberships.map((m) => ({ orgId: m.organization_id, orgName: m.name, role: (isRoleKey(m.role_key) ? m.role_key : "viewer") as RoleKey })),
    sites,
    siteId,
    range: resolveRange(rangeKey, today),
    today,
    permissions: ROLES[role].permissions,
  };
});

/** Require a signed-in user (redirects to /login). */
export async function requireUser(): Promise<CurrentUser> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  return current;
}

/** Require a permission for page access (renders the forbidden state via redirect target). */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const current = await requireUser();
  if (!current.permissions.includes(permission)) redirect(`/forbidden?need=${encodeURIComponent(permission)}`);
  return current;
}
