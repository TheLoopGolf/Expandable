import { z } from "zod";
import { orgSettingsInput, memberInput } from "@/lib/validation";
import type { Database } from "../db";
import { authorize, type ServiceContext } from "../context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { ROLE_KEYS } from "@/lib/permissions";
import { recordAudit } from "./audit";
import { FEATURE_FLAGS } from "./features";

export { FEATURE_FLAGS, type FeatureFlag } from "./features";


export async function updateOrganization(db: Database, ctx: ServiceContext, raw: z.input<typeof orgSettingsInput>) {
  authorize(ctx, "admin.manage");
  const input = orgSettingsInput.parse(raw);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
  } catch {
    throw new ValidationError("Unknown timezone.", { timezone: "Use an IANA name such as America/Chicago" });
  }
  return db.transaction(async (tx) => {
    const [before] = await tx.query<{ name: string; timezone: string; settings: Record<string, unknown> }>(
      `select name, timezone, settings from organizations where id = $1 for update`,
      [ctx.orgId],
    );
    if (!before) throw new NotFoundError("Organization");
    const features = Object.fromEntries(Object.entries(input.features).filter(([k]) => k in FEATURE_FLAGS));
    const settings = { ...(before.settings ?? {}), features: { ...((before.settings?.features as object) ?? {}), ...features } };
    await tx.query(`update organizations set name = $2, timezone = $3, settings = $4::jsonb where id = $1`, [ctx.orgId, input.name, input.timezone, JSON.stringify(settings)]);
    await recordAudit(tx, ctx, {
      action: "organization.updated",
      entityType: "organization",
      entityId: ctx.orgId,
      summary: `Updated organization settings`,
      before,
      after: { name: input.name, timezone: input.timezone, settings },
    });
    return { id: ctx.orgId };
  });
}


export async function addMember(db: Database, ctx: ServiceContext, raw: z.input<typeof memberInput>) {
  authorize(ctx, "admin.manage");
  const input = memberInput.parse(raw);
  return db.transaction(async (tx) => {
    let [profile] = await tx.query<{ id: string }>(`select id from profiles where lower(email) = $1`, [input.email]);
    if (!profile) {
      [profile] = await tx.query<{ id: string }>(
        `insert into profiles (email, full_name, title) values ($1, $2, $3) returning id`,
        [input.email, input.fullName, input.title ?? null],
      );
    }
    const [existing] = await tx.query(`select 1 from memberships where organization_id = $1 and profile_id = $2`, [ctx.orgId, profile.id]);
    if (existing) throw new ConflictError(`${input.email} is already a member.`);
    await tx.query(`insert into memberships (organization_id, profile_id, role_key) values ($1, $2, $3)`, [ctx.orgId, profile.id, input.role]);
    await recordAudit(tx, ctx, {
      action: "member.added",
      entityType: "membership",
      entityId: profile.id,
      summary: `Added ${input.fullName} (${input.email}) as ${input.role}`,
      after: { role: input.role },
    });
    return { profileId: profile.id };
  });
}

export async function updateMemberRole(db: Database, ctx: ServiceContext, profileId: string, role: string, active = true) {
  authorize(ctx, "admin.manage");
  const parsedRole = z.enum(ROLE_KEYS).parse(role);
  return db.transaction(async (tx) => {
    const [m] = await tx.query<{ id: string; role_key: string; is_active: boolean; full_name: string }>(
      `select m.id, m.role_key, m.is_active, p.full_name from memberships m join profiles p on p.id = m.profile_id
       where m.organization_id = $1 and m.profile_id = $2 for update of m`,
      [ctx.orgId, profileId],
    );
    if (!m) throw new NotFoundError("Member");
    if (profileId === ctx.userId && (parsedRole !== "admin" || !active)) {
      throw new ValidationError("You cannot remove your own admin access.");
    }
    if (m.role_key === "admin" && (parsedRole !== "admin" || !active)) {
      const [{ n }] = await tx.query<{ n: number }>(
        `select count(*) as n from memberships where organization_id = $1 and role_key = 'admin' and is_active`,
        [ctx.orgId],
      );
      if (Number(n) <= 1) throw new ValidationError("The organization needs at least one active admin.");
    }
    await tx.query(`update memberships set role_key = $2, is_active = $3 where id = $1`, [m.id, parsedRole, active]);
    await recordAudit(tx, ctx, {
      action: "member.updated",
      entityType: "membership",
      entityId: profileId,
      summary: `Changed ${m.full_name}: ${m.role_key}${m.is_active ? "" : " (inactive)"} → ${parsedRole}${active ? "" : " (inactive)"}`,
      before: { role: m.role_key, active: m.is_active },
      after: { role: parsedRole, active },
    });
    return { profileId };
  });
}
