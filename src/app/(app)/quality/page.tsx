import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Section, SimpleTable, StatCard } from "@/components/detail";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { listCapas, listInspections, listQualityEvents } from "@/server/queries/quality";
import { getActiveHolds } from "@/server/queries/dashboard-roles";
import { itemOptions, lotOptions } from "@/server/queries/lookups";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EventsTable, InspectionDialog, InspectionsTable } from "./tables";
import { CapaStatusButton, ReleaseHoldButton } from "./quality-actions";

export const metadata: Metadata = { title: "Quality" };

const TABS = [
  { key: "events", label: "Events (NCR / complaints)" },
  { key: "holds", label: "Quality holds" },
  { key: "capa", label: "CAPA" },
  { key: "inspections", label: "Inspections" },
] as const;

export default async function QualityPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePermission("quality.view");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "events";
  const db = await getDb();
  const [events, holds, capas] = await Promise.all([listQualityEvents(db, user.ctx, user.today), getActiveHolds(db, user.ctx), listCapas(db, user.ctx, user.today)]);
  const can = (p: string) => user.permissions.includes(p as never);
  const open = events.filter((e) => e.open);
  return (
    <>
      <PageHeader
        title="Quality"
        description="Nonconformances, customer complaints, lot holds, corrective/preventive actions and inspections. These records support a quality process; they do not by themselves make the system validated for regulated use."
        breadcrumbs={[{ label: "Operations" }, { label: "Quality" }]}
        actions={
          can("quality.manage") && (
            <Button asChild size="sm">
              <Link href="/quality/new">
                <Plus /> Open nonconformance
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open events" value={open.length} sub={`${open.filter((e) => e.severity === "critical" || e.severity === "high").length} high or critical`} />
        <StatCard label="Overdue events" value={open.filter((e) => e.overdue).length} tone={open.some((e) => e.overdue) ? "danger" : undefined} />
        <StatCard label="Lots on hold" value={holds.length} sub={`${formatNumber(holds.reduce((s, h) => s + h.qty, 0), 0)} units blocked`} />
        <StatCard label="Overdue CAPA" value={capas.filter((c) => c.overdue).length} tone={capas.some((c) => c.overdue) ? "danger" : undefined} sub={`${capas.filter((c) => ["open", "in_progress"].includes(c.status)).length} open`} />
      </div>
      <nav className="mb-4 flex flex-wrap gap-1 border-b" aria-label="Quality sections">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/quality?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground", tab === t.key ? "border-primary text-foreground" : "border-transparent")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "events" && <EventsTable rows={events} />}
      {tab === "holds" && (
        <Section title={`Active holds (${holds.length})`} description="Held lots cannot be issued to production or shipped. Release requires the quality-hold permission and a documented justification.">
          <SimpleTable
            head={["Lot", "Item", "Qty held", "Reason", "Event", "Placed", ""]}
            align={["left", "left", "right", "left", "left", "left", "left"]}
            empty="No active holds."
            rows={holds.map((h) => [
              <Link key="l" href={`/inventory/lots?lot=${encodeURIComponent(h.lot_number)}`} className="font-mono text-xs font-medium text-primary hover:underline">{h.lot_number}</Link>,
              h.sku,
              formatNumber(h.qty),
              <span key="r" className="line-clamp-2 max-w-[320px] text-xs text-muted-foreground">{h.reason}</span>,
              h.event_id ? <Link key="e" href={`/quality/events/${h.event_id}`} className="hover:underline">{h.event_number}</Link> : "—",
              <span key="p" className="text-xs text-muted-foreground whitespace-nowrap">{h.placed_by} · {formatRelative(new Date(h.placed_at))}</span>,
              can("quality.hold") ? <ReleaseHoldButton key="b" holdId={h.id} lotNumber={h.lot_number} reason={h.reason} /> : null,
            ])}
          />
        </Section>
      )}
      {tab === "capa" && (
        <Section title="Corrective and preventive actions">
          <SimpleTable
            head={["CAPA", "Type", "Action", "Owner", "Due", "Status", "Event", ""]}
            empty="No CAPA records."
            rows={capas.map((c) => [
              <span key="n" className="font-medium">{c.capa_number}</span>,
              <span key="t" className="capitalize">{c.action_type}</span>,
              <span key="d" className="line-clamp-2 max-w-[360px]">{c.description}</span>,
              c.owner ?? "—",
              <span key="du" className={c.overdue ? "font-medium text-destructive" : ""}>{formatDate(c.due_date, { year: false })}</span>,
              <StatusBadge key="s" status={c.overdue ? "overdue" : c.status} />,
              c.event_id ? <Link key="e" href={`/quality/events/${c.event_id}`} className="hover:underline">{c.event_number}</Link> : "—",
              can("quality.manage") && c.status !== "closed" ? <CapaStatusButton key="a" id={c.id} number={c.capa_number} status={c.status} /> : null,
            ])}
          />
        </Section>
      )}
      {tab === "inspections" && <InspectionsTab canManage={can("quality.manage")} user={user} />}
    </>
  );
}

async function InspectionsTab({ canManage, user }: { canManage: boolean; user: Awaited<ReturnType<typeof requirePermission>> }) {
  const db = await getDb();
  const [rows, items, lots] = await Promise.all([listInspections(db, user.ctx), itemOptions(db, user.ctx), lotOptions(db, user.ctx)]);
  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <InspectionDialog items={items} lots={lots} />
        </div>
      )}
      <InspectionsTable rows={rows.map((r) => ({ ...r, inspected_at: new Date(r.inspected_at).toISOString() }))} timeZone={user.org.timezone} />
    </div>
  );
}
