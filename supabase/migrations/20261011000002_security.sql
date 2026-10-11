-- ForgeFlow ERP — row level security
--
-- Model:
--   * The Next.js server connects with the database owner role and performs every write
--     through the service layer, which authorizes the caller and scopes by organization.
--   * Supabase client roles (anon / authenticated) may only READ rows of organizations they
--     belong to. There are deliberately no INSERT/UPDATE/DELETE policies, so direct client
--     writes to inventory-posting and accounting tables are impossible.
--
-- Compatibility shim: on plain Postgres / PGlite (demo mode) the Supabase roles and the
-- auth.uid() helper do not exist, so they are created here. On Supabase they already exist
-- and are left untouched.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end;
$$;

create schema if not exists auth;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $fn$
      create function auth.uid() returns uuid
      language sql stable as $body$
        select nullif(
          coalesce(
            nullif(current_setting('request.jwt.claim.sub', true), ''),
            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
          ), ''
        )::uuid
      $body$
    $fn$;
  end if;
end;
$$;

-- Membership helpers. SECURITY DEFINER so policies can consult memberships without
-- recursively applying RLS to the memberships table itself.
create or replace function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from memberships m
    join profiles p on p.id = m.profile_id
    where m.organization_id = p_org
      and m.is_active
      and p.auth_user_id = auth.uid()
  );
$$;

create or replace function app.shares_org_with(p_profile uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from memberships mine
    join profiles me on me.id = mine.profile_id and me.auth_user_id = auth.uid()
    join memberships theirs on theirs.organization_id = mine.organization_id
    where theirs.profile_id = p_profile and mine.is_active
  );
$$;

grant usage on schema app to authenticated;
grant execute on function app.is_member(uuid) to authenticated;
grant execute on function app.shares_org_with(uuid) to authenticated;

-- Organizations and identity tables have bespoke policies.
alter table organizations enable row level security;
create policy organizations_member_read on organizations
  for select to authenticated using (app.is_member(id));

alter table profiles enable row level security;
create policy profiles_self_or_colleague_read on profiles
  for select to authenticated
  using (auth_user_id = auth.uid() or app.shares_org_with(id));

alter table roles enable row level security;
create policy roles_read on roles for select to authenticated using (true);

-- Server-only tables: RLS on, no policies => no client access at all.
alter table idempotency_keys enable row level security;
alter table number_sequences enable row level security;

-- Every other tenant table: members may read their organization's rows; nobody writes
-- through the client API.
do $$
declare
  t text;
begin
  foreach t in array array[
    'sites', 'memberships', 'warehouses', 'bins', 'suppliers', 'customers', 'work_centers',
    'items', 'boms', 'bom_lines', 'engineering_changes', 'item_revisions', 'routing_operations',
    'inventory_lots', 'inventory_balances', 'inventory_movements', 'inventory_reservations',
    'purchase_orders', 'purchase_order_lines', 'goods_receipts', 'supplier_bills',
    'sales_orders', 'sales_order_lines', 'shipments', 'shipment_lines', 'invoices',
    'invoice_lines', 'payments', 'work_orders', 'work_order_materials',
    'work_order_operations', 'material_issues', 'production_receipts', 'quality_events',
    'inspections', 'quality_holds', 'capa_actions', 'mrp_runs', 'mrp_suggestions',
    'accounts', 'journal_entries', 'journal_lines', 'audit_events'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated using (app.is_member(organization_id))',
      t || '_member_read', t
    );
  end loop;
end;
$$;

-- Privileges: read-only for client roles, and nothing at all for anonymous callers.
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
revoke all on all tables in schema public from anon;
