import type { Sql } from "../db";
import type { ServiceContext } from "../context";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  entityNumber?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  siteId?: string | null;
}

/** Append an immutable audit/business event (shown in activity feeds and history). */
export async function recordAudit(tx: Sql, ctx: ServiceContext, input: AuditInput): Promise<void> {
  await tx.query(
    `insert into audit_events
       (organization_id, actor_id, actor_name, action, entity_type, entity_id, entity_number,
        summary, before, after, metadata, site_id, occurred_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13)`,
    [
      ctx.orgId,
      ctx.userId,
      ctx.userName,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.entityNumber ?? null,
      input.summary,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      ctx.seed
        ? JSON.stringify({ ...((input.metadata as object | undefined) ?? {}), seed: true })
        : input.metadata === undefined
          ? null
          : JSON.stringify(input.metadata),
      input.siteId ?? null,
      ctx.now(),
    ],
  );
}
