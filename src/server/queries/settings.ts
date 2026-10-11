import type { Sql } from "../db";
import { authorize, type ServiceContext } from "../context";
import { resolveFeatures } from "../services/features";

export async function getOrganization(db: Sql, ctx: ServiceContext) {
  const [org] = await db.query<{ id: string; name: string; slug: string; timezone: string; base_currency: string; is_demo: boolean; settings: Record<string, unknown>; created_at: string }>(
    `select id, name, slug, timezone, base_currency, is_demo, settings, created_at::text from organizations where id = $1`,
    [ctx.orgId],
  );
  return { ...org, features: resolveFeatures(org.settings?.features) };
}

export async function listSitesAndWarehouses(db: Sql, ctx: ServiceContext) {
  const sites = await db.query<{ id: string; code: string; name: string; timezone: string; address: string | null }>(
    `select id, code, name, timezone, address from sites where organization_id = $1 order by code`,
    [ctx.orgId],
  );
  const warehouses = await db.query<{ id: string; site_id: string; code: string; name: string; kind: string; is_active: boolean; bins: number; skus: number }>(
    `select w.id, w.site_id, w.code, w.name, w.kind, w.is_active,
            (select count(*) from bins b where b.warehouse_id = w.id) as bins,
            (select count(distinct ib.item_id) from inventory_balances ib where ib.warehouse_id = w.id and ib.qty_on_hand > 0) as skus
     from warehouses w where w.organization_id = $1 order by w.code`,
    [ctx.orgId],
  );
  const workCenters = await db.query<{ id: string; site_id: string; code: string; name: string; kind: string; capacity_hours_per_day: string; hourly_rate: string }>(
    `select id, site_id, code, name, kind, capacity_hours_per_day, hourly_rate from work_centers where organization_id = $1 order by code`,
    [ctx.orgId],
  );
  return sites.map((s) => ({
    ...s,
    warehouses: warehouses.filter((w) => w.site_id === s.id).map((w) => ({ ...w, bins: Number(w.bins), skus: Number(w.skus) })),
    workCenters: workCenters.filter((w) => w.site_id === s.id),
  }));
}

export async function listMembers(db: Sql, ctx: ServiceContext) {
  return db.query<{ profile_id: string; full_name: string; email: string; title: string | null; role_key: string; is_active: boolean; joined: string; last_action: string | null }>(
    `select p.id as profile_id, p.full_name, p.email, p.title, m.role_key, m.is_active, m.created_at::text as joined,
            (select max(a.occurred_at)::text from audit_events a where a.organization_id = m.organization_id and a.actor_id = p.id) as last_action
     from memberships m join profiles p on p.id = m.profile_id
     where m.organization_id = $1 order by m.is_active desc, p.full_name`,
    [ctx.orgId],
  );
}

export interface AuditRow {
  id: string;
  seq: number;
  occurred_at: string;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_number: string | null;
  summary: string;
  seeded: boolean;
  has_diff: boolean;
}

export async function listAuditEvents(db: Sql, ctx: ServiceContext, from: string, to: string, limit = 1000): Promise<AuditRow[]> {
  authorize(ctx, "audit.view");
  return db.query<AuditRow>(
    `select id, seq, occurred_at::text, actor_name, action, entity_type, entity_id, entity_number, summary,
            coalesce((metadata ->> 'seed')::boolean, false) as seeded, (before is not null or after is not null) as has_diff
     from audit_events
     where organization_id = $1 and (occurred_at at time zone $4)::date between $2 and $3
     order by seq desc limit $5`,
    [ctx.orgId, from, to, ctx.timezone, limit],
  );
}

export async function getAuditEvent(db: Sql, ctx: ServiceContext, id: string) {
  authorize(ctx, "audit.view");
  const [row] = await db.query<{ before: unknown; after: unknown; metadata: unknown }>(
    `select before, after, metadata from audit_events where organization_id = $1 and id = $2`,
    [ctx.orgId, id],
  );
  return row ?? null;
}

export async function getDataStatus(db: Sql, ctx: ServiceContext) {
  const [counts] = await db.query<{ items: number; movements: number; journals: number; audit: number; orgs: number }>(
    `select (select count(*) from items where organization_id = $1) as items,
            (select count(*) from inventory_movements where organization_id = $1) as movements,
            (select count(*) from journal_entries where organization_id = $1) as journals,
            (select count(*) from audit_events where organization_id = $1) as audit,
            (select count(*) from organizations) as orgs`,
    [ctx.orgId],
  );
  const [recon] = await db.query<{ mismatches: number }>(
    `with ledger as (
       select item_id, warehouse_id, coalesce(bin_id::text, '') as bin, coalesce(lot_id::text, '') as lot, sum(quantity) as q
       from inventory_movements where organization_id = $1 group by 1, 2, 3, 4
     ), bal as (
       select item_id, warehouse_id, coalesce(bin_id::text, '') as bin, coalesce(lot_id::text, '') as lot, sum(qty_on_hand) as q
       from inventory_balances where organization_id = $1 group by 1, 2, 3, 4
     )
     select count(*) as mismatches from ledger l full join bal b
       on b.item_id = l.item_id and b.warehouse_id = l.warehouse_id and b.bin = l.bin and b.lot = l.lot
     where coalesce(l.q, 0) <> coalesce(b.q, 0)`,
    [ctx.orgId],
  );
  const [unbalanced] = await db.query<{ n: number }>(
    `select count(*) as n from (select journal_entry_id from journal_lines where organization_id = $1 group by journal_entry_id having sum(debit) <> sum(credit)) x`,
    [ctx.orgId],
  );
  return {
    items: Number(counts.items),
    movements: Number(counts.movements),
    journals: Number(counts.journals),
    audit: Number(counts.audit),
    organizations: Number(counts.orgs),
    ledgerMismatches: Number(recon.mismatches),
    unbalancedJournals: Number(unbalanced.n),
  };
}
