import type { Metadata } from "next";
import Link from "next/link";
import { Check, Database, Info, Minus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Section, SimpleTable, StatCard } from "@/components/detail";
import { requireUser } from "@/server/auth/current";
import { config } from "@/server/config";
import { databaseMode, getDb, pgliteDataDir } from "@/server/db";
import { FEATURE_FLAGS } from "@/server/services/features";
import { getDataStatus, getOrganization, listAuditEvents, listMembers, listSitesAndWarehouses } from "@/server/queries/settings";
import { PERMISSIONS, ROLES, ROLE_KEYS, type Permission } from "@/lib/permissions";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AuditTable, MembersTable, OrganizationForm, ResetDemoData } from "./settings-client";

export const metadata: Metadata = { title: "Settings" };

const TABS: { key: string; label: string; permission?: Permission }[] = [
  { key: "organization", label: "Organization" },
  { key: "sites", label: "Sites & warehouses" },
  { key: "members", label: "Members" },
  { key: "roles", label: "Roles & permissions" },
  { key: "audit", label: "Audit trail", permission: "audit.view" },
  { key: "data", label: "Data & environment" },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const can = (p: Permission) => user.permissions.includes(p);
  const tabs = TABS.filter((t) => !t.permission || can(t.permission));
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "organization";
  const db = await getDb();
  const isAdmin = can("admin.manage");

  return (
    <>
      <PageHeader
        title="Settings"
        description={isAdmin ? "Organization profile, operating policies, team access and data." : "Organization configuration. Only admins can change these settings."}
        breadcrumbs={[{ label: "Administration" }, { label: "Settings" }]}
      />
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b" aria-label="Settings sections">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/settings?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] whitespace-nowrap",
              t.key === tab ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "organization" && <OrganizationTab userCtx={user.ctx} canEdit={isAdmin} db={db} />}
      {tab === "sites" && <SitesTab db={db} ctx={user.ctx} />}
      {tab === "members" && <MembersTab db={db} ctx={user.ctx} canManage={isAdmin} selfId={user.user.id} />}
      {tab === "roles" && <RolesTab currentRole={user.ctx.role} />}
      {tab === "audit" && <AuditTab db={db} ctx={user.ctx} range={user.range} />}
      {tab === "data" && <DataTab db={db} ctx={user.ctx} isAdmin={isAdmin} isDemoOrg={user.org.isDemo} seededFor={user.org.seededFor} />}
    </>
  );
}

type Db = Awaited<ReturnType<typeof getDb>>;
type Ctx = Awaited<ReturnType<typeof requireUser>>["ctx"];

async function OrganizationTab({ db, userCtx, canEdit }: { db: Db; userCtx: Ctx; canEdit: boolean }) {
  const org = await getOrganization(db, userCtx);
  return (
    <OrganizationForm
      org={{ name: org.name, timezone: org.timezone, features: org.features }}
      flags={Object.entries(FEATURE_FLAGS).map(([key, label]) => ({ key, label }))}
      canEdit={canEdit}
    />
  );
}

async function SitesTab({ db, ctx }: { db: Db; ctx: Ctx }) {
  const sites = await listSitesAndWarehouses(db, ctx);
  return (
    <div className="space-y-4">
      {sites.map((s) => (
        <Section key={s.id} title={`${s.code} · ${s.name}`} description={`${s.address ?? "No address"} · ${s.timezone}`}>
          <div className="grid gap-4 p-0 xl:grid-cols-2">
            <SimpleTable
              head={["Warehouse", "Type", "Bins", "SKUs in stock", "Status"]}
              align={["left", "left", "right", "right", "left"]}
              rows={s.warehouses.map((w) => [
                <span key="c" className="font-medium">
                  {w.code} <span className="font-normal text-muted-foreground">· {w.name}</span>
                </span>,
                w.kind.replace("_", " "),
                formatNumber(w.bins),
                formatNumber(w.skus),
                w.is_active ? "Active" : "Inactive",
              ])}
            />
            <SimpleTable
              head={["Work center", "Type", "Hours / day", "Rate / hour"]}
              align={["left", "left", "right", "right"]}
              empty="No work centers at this site"
              rows={s.workCenters.map((w) => [
                <span key="c" className="font-medium">
                  {w.code} <span className="font-normal text-muted-foreground">· {w.name}</span>
                </span>,
                w.kind,
                formatNumber(w.capacity_hours_per_day),
                formatCurrency(w.hourly_rate, { cents: true }),
              ])}
            />
          </div>
        </Section>
      ))}
      <p className="text-xs text-muted-foreground">Creating sites, warehouses, bins and work centers from the UI is planned; today they are defined by the seed or SQL (see NEXT_STEPS.md).</p>
    </div>
  );
}

async function MembersTab({ db, ctx, canManage, selfId }: { db: Db; ctx: Ctx; canManage: boolean; selfId: string }) {
  const rows = await listMembers(db, ctx);
  return (
    <div className="space-y-3">
      {!canManage && <p className="text-[13px] text-muted-foreground">Only admins can add members or change roles.</p>}
      <MembersTable rows={rows} canManage={canManage} selfId={selfId} />
    </div>
  );
}

function RolesTab({ currentRole }: { currentRole: string }) {
  const perms = Object.entries(PERMISSIONS) as [Permission, string][];
  return (
    <div className="space-y-3">
      <div className="flex gap-2.5 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px] text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        Permissions are checked by the server on every action and query; hiding a button in the UI is only a convenience. Database row-level security
        additionally limits reads to organizations the user belongs to.
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="sticky left-0 bg-card px-4 py-2 font-medium">Permission</th>
              {ROLE_KEYS.map((r) => (
                <th key={r} className={cn("px-2 py-2 text-center font-medium whitespace-nowrap", r === currentRole && "text-primary")}>
                  {ROLES[r].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {perms.map(([p, label]) => (
              <tr key={p} className="border-b border-border/60 last:border-0">
                <td className="sticky left-0 bg-card px-4 py-1.5">
                  <div>{label}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{p}</div>
                </td>
                {ROLE_KEYS.map((r) => (
                  <td key={r} className={cn("px-2 py-1.5 text-center", r === currentRole && "bg-accent/40")}>
                    {ROLES[r].permissions.includes(p) ? (
                      <Check className="mx-auto size-4 text-success" aria-label="Allowed" />
                    ) : (
                      <Minus className="mx-auto size-4 text-muted-foreground/40" aria-label="Not allowed" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {ROLE_KEYS.map((r) => (
          <div key={r} className="rounded-xl border bg-card p-3">
            <div className="text-sm font-medium">{ROLES[r].name}</div>
            <p className="mt-0.5 text-xs text-muted-foreground">{ROLES[r].description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

async function AuditTab({ db, ctx, range }: { db: Db; ctx: Ctx; range: { from: string; to: string; label: string } }) {
  const rows = await listAuditEvents(db, ctx, range.from, range.to);
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">
        Append-only record of every change made through the application ({range.label}, newest first, up to 1,000 entries). Entries marked{" "}
        <span className="font-medium text-foreground">seeded</span> were generated by the demo data simulation, not entered by a person.
      </p>
      <AuditTable rows={rows} timezone={ctx.timezone} />
    </div>
  );
}

async function DataTab({ db, ctx, isAdmin, isDemoOrg, seededFor }: { db: Db; ctx: Ctx; isAdmin: boolean; isDemoOrg: boolean; seededFor: string | null }) {
  const status = await getDataStatus(db, ctx);
  const mode = databaseMode();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Database" value={mode === "pglite" ? "Local demo (PGlite)" : "PostgreSQL"} sub={mode === "pglite" ? pgliteDataDir() : "DATABASE_URL"} />
        <StatCard label="Authentication" value={config.authMode === "demo" ? "Demo personas" : "Supabase Auth"} sub={`AUTH_MODE=${config.authMode}`} />
        <StatCard
          label="Ledger vs balances"
          value={status.ledgerMismatches === 0 ? "Reconciled" : `${status.ledgerMismatches} mismatches`}
          sub={`${formatNumber(status.movements)} movements`}
          tone={status.ledgerMismatches === 0 ? "success" : "danger"}
        />
        <StatCard
          label="Journal entries"
          value={status.unbalancedJournals === 0 ? "All balanced" : `${status.unbalancedJournals} unbalanced`}
          sub={`${formatNumber(status.journals)} entries`}
          tone={status.unbalancedJournals === 0 ? "success" : "danger"}
        />
      </div>
      <Section title="Demo data" description="How the sample data in this workspace was produced.">
        <div className="space-y-3 p-4 text-[13px] leading-relaxed">
          {isDemoOrg ? (
            <p>
              This organization is a <span className="font-medium">demo workspace</span>. Its history was generated by replaying 180 days of fictional
              purchasing, production, sales and quality transactions through the same services the UI uses
              {seededFor ? `, ending ${formatDate(seededFor)}` : ""}. Activity is simulated — it is not live telemetry from any plant, and the
              companies, people and products are fictional.
            </p>
          ) : (
            <p>This organization is not marked as a demo workspace.</p>
          )}
          <p className="text-muted-foreground">
            {formatNumber(status.items)} items · {formatNumber(status.audit)} audit events · {formatNumber(status.organizations)} organizations in this database.
          </p>
        </div>
      </Section>
      {isAdmin && (
        <Section title="Reset" description="Rebuild the database from the seed.">
          <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex gap-2.5 text-[13px] text-muted-foreground">
              <Database className="mt-0.5 size-4 shrink-0" />
              {config.allowDemoReset
                ? "Deletes every organization in this database and regenerates the sample history. Use it to start the walkthrough again."
                : "Reset is disabled for this database. Set ALLOW_DEMO_RESET=true on a dedicated demo database to enable it, or run npm run db:reset from a terminal."}
            </div>
            {config.allowDemoReset && <ResetDemoData />}
          </div>
        </Section>
      )}
      <p className="text-xs text-muted-foreground">Server time {formatDateTime(new Date(), ctx.timezone)} ({ctx.timezone}).</p>
    </div>
  );
}
