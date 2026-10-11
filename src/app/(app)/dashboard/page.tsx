import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { BacklogChart, OrderTrendChart, ProductionChart, SeverityChart } from "@/components/charts/dashboard-charts";
import { SeverityBadge, StatusBadge, ToneBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import {
  getActivity,
  getBacklog,
  getInventoryAlerts,
  getKpis,
  getOrderTrend,
  getProductFamilies,
  getProductionQueue,
  getProductionTrend,
  getQualitySummary,
  type DashboardFilters,
} from "@/server/queries/dashboard";
import { getActiveHolds, getInspectionStats, getLastMrpRun, getOpenQualityEvents, getReceiptsDue, getRecentMovements, getShipmentsDue } from "@/server/queries/dashboard-roles";
import { formatDate, formatDateTime, formatNumber, formatQty, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DashboardControls } from "./controls";
import { DASHBOARD_VIEWS as VIEWS } from "@/lib/quick-actions";
import { FastActions } from "./fast-actions";
import { ActivityFeed, AlertsList, Panel, PanelLink, ProductionQueue } from "./panels";

export const metadata: Metadata = { title: "Dashboard" };

type View = (typeof VIEWS)[number]["key"];

const DEFAULT_VIEW: Record<string, View> = { planner: "planner", warehouse: "warehouse", quality: "quality" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string; family?: string }> }) {
  const user = await requirePermission("dashboard.view");
  const sp = await searchParams;
  const view: View = VIEWS.some((v) => v.key === sp.view) ? (sp.view as View) : (DEFAULT_VIEW[user.user.role] ?? "executive");
  const db = await getDb();
  const families = await getProductFamilies(db, user.ctx);
  const family = sp.family && families.includes(sp.family) ? sp.family : null;
  const f: DashboardFilters = { range: user.range, today: user.today, siteId: user.siteId, family };
  const site = user.sites.find((s) => s.id === user.siteId);
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Operations overview"
        description={`${user.org.name} · ${site ? site.name : "All plants"} · ${user.range.label} (${formatDate(user.range.from, { year: false })} – ${formatDate(user.range.to)})${family ? ` · ${family}` : ""}`}
        meta={
          <span>
            Updated {formatDateTime(now, user.org.timezone)} from posted transactions
          </span>
        }
      />
      <DashboardControls view={view} family={family} families={families} />
      <FastActions permissions={user.permissions} />
      {view === "executive" && <ExecutiveView user={user} f={f} now={now} />}
      {view === "planner" && <PlannerView user={user} f={f} />}
      {view === "warehouse" && <WarehouseView user={user} f={f} now={now} />}
      {view === "quality" && <QualityView user={user} f={f} />}
    </>
  );
}

type Props = { user: Awaited<ReturnType<typeof requirePermission>>; f: DashboardFilters; now?: Date };

async function ExecutiveView({ user, f, now }: Props) {
  const db = await getDb();
  const [kpis, orderTrend, prodTrend, backlog, queue, alerts, quality, activity] = await Promise.all([
    getKpis(db, user.ctx, f),
    getOrderTrend(db, user.ctx, f),
    getProductionTrend(db, user.ctx, f),
    getBacklog(db, user.ctx, f),
    getProductionQueue(db, user.ctx, f, 10),
    getInventoryAlerts(db, user.ctx, f),
    getQualitySummary(db, user.ctx, f),
    getActivity(db, user.ctx, { siteId: f.siteId, limit: 14 }),
  ]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
        {kpis.map((k) => (
          <KpiCard key={k.key} kpi={k} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <OrderTrendChart {...orderTrend} />
        </div>
        <div className="xl:col-span-2">
          <BacklogChart rows={backlog} />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <ProductionChart {...prodTrend} />
        </div>
        <QualityPanel quality={quality} className="xl:col-span-2" />
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title="Production queue" action={<PanelLink href="/production">All work orders</PanelLink>} className="xl:col-span-3">
          <ProductionQueue rows={queue} today={f.today} />
        </Panel>
        <Panel title={`Inventory alerts (${alerts.length})`} action={<PanelLink href="/inventory?alert=any">Inventory</PanelLink>} className="xl:col-span-2">
          <AlertsList alerts={alerts} />
        </Panel>
      </div>
      <Panel title="Recent activity" action={user.permissions.includes("audit.view") ? <PanelLink href="/settings?tab=audit">Audit trail</PanelLink> : undefined}>
        <ActivityFeed items={activity} now={now ?? new Date()} />
      </Panel>
    </div>
  );
}

function QualityPanel({ quality, className }: { quality: Awaited<ReturnType<typeof getQualitySummary>>; className?: string }) {
  const open = quality.severity.reduce((s, x) => s + x.count, 0);
  return (
    <Panel title="Quality events" action={<PanelLink href="/quality">Quality</PanelLink>} className={className}>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <div>
          <div className="text-xs text-muted-foreground">Open events by severity</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold">{open}</span>
            <span className="text-xs text-muted-foreground">
              open · {quality.activeHolds} lot{quality.activeHolds === 1 ? "" : "s"} on hold ({formatNumber(quality.heldQty, 0)} units)
            </span>
          </div>
          <div className="mt-2 h-[132px]">
            <SeverityChart data={quality.severity} />
          </div>
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 text-xs text-muted-foreground">Overdue actions ({quality.overdue.length})</div>
          {quality.overdue.length === 0 ? (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">Nothing overdue.</div>
          ) : (
            <ul className="space-y-1.5">
              {quality.overdue.slice(0, 5).map((o) => (
                <li key={o.kind + o.id}>
                  <Link href={`/quality/events/${o.href_id}`} className="block rounded-md border px-2.5 py-1.5 hover:bg-muted/50">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium">{o.number}</span>
                      <span className="font-medium text-destructive">{o.daysOverdue}d overdue</span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{o.title}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

async function PlannerView({ user, f }: Props) {
  const db = await getDb();
  const [kpis, prodTrend, queue, alerts, mrp] = await Promise.all([
    getKpis(db, user.ctx, f),
    getProductionTrend(db, user.ctx, f),
    getProductionQueue(db, user.ctx, f, 40),
    getInventoryAlerts(db, user.ctx, f),
    getLastMrpRun(db, user.ctx),
  ]);
  const pick = kpis.filter((k) => ["wo-schedule", "shortages", "otd", "open-orders"].includes(k.key));
  const shortages = alerts.filter((a) => a.kind === "critical_shortage" || a.kind === "shortage" || a.kind === "unallocated");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        {pick.map((k) => (
          <KpiCard key={k.key} kpi={k} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ProductionChart {...prodTrend} />
        </div>
        <Panel title="Last MRP run" action={<PanelLink href="/planning/mrp">Open workbench</PanelLink>}>
          {mrp ? (
            <div className="space-y-3 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{mrp.run_number}</span>
                <span className="text-xs text-muted-foreground">{formatRelative(new Date(mrp.completed_at))}</span>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="Open suggestions" value={Number(mrp.open)} />
                <Stat label="Late releases" value={mrp.summary.late ?? 0} danger />
                <Stat label="Buy" value={mrp.summary.purchase ?? 0} />
                <Stat label="Make" value={mrp.summary.manufacture ?? 0} />
              </dl>
              <p className="text-xs text-muted-foreground">{mrp.horizon_days}-day horizon. Suggestions are never placed automatically; approval creates drafts.</p>
            </div>
          ) : (
            <EmptyState title="MRP has not been run" className="m-4" />
          )}
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title={`Production queue (${queue.length})`} action={<PanelLink href="/production/schedule">Schedule board</PanelLink>} className="xl:col-span-3">
          <ProductionQueue rows={queue} today={f.today} />
        </Panel>
        <Panel title={`Material shortages (${shortages.length})`} action={<PanelLink href="/planning/mrp">Plan supply</PanelLink>} className="xl:col-span-2">
          <AlertsList alerts={shortages} limit={14} />
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-md border px-2.5 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-lg font-semibold", danger && value > 0 && "text-destructive")}>{value}</dd>
    </div>
  );
}

async function WarehouseView({ user, f, now }: Props) {
  const db = await getDb();
  const [receipts, shipments, alerts, movements] = await Promise.all([
    getReceiptsDue(db, user.ctx, f),
    getShipmentsDue(db, user.ctx, f),
    getInventoryAlerts(db, user.ctx, f),
    getRecentMovements(db, user.ctx, f, 14),
  ]);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={`Inbound receipts due in 7 days (${receipts.length})`} action={<PanelLink href="/purchasing/receive">Receive</PanelLink>}>
          {receipts.length === 0 ? (
            <EmptyState title="No receipts due" className="m-4" />
          ) : (
            <SimpleTable
              head={["PO", "Supplier", "Item", "Open", "Expected"]}
              rows={receipts.map((r) => [
                <Link key="a" href={`/purchasing/orders/${r.po_id}`} className="font-medium text-primary hover:underline">{r.po_number}</Link>,
                <span key="b" className="text-muted-foreground">{r.supplier}</span>,
                r.sku,
                <span key="c" className="tabular">{formatNumber(r.open)}</span>,
                <span key="d" className={cn("whitespace-nowrap", r.late && "font-medium text-destructive")}>{r.late ? "Late · " : ""}{formatDate(r.expected_date, { year: false })}</span>,
              ])}
            />
          )}
        </Panel>
        <Panel title={`Shipments due in 7 days (${shipments.length})`} action={<PanelLink href="/sales/orders?bucket=open">Sales orders</PanelLink>}>
          {shipments.length === 0 ? (
            <EmptyState title="No shipments due" className="m-4" />
          ) : (
            <SimpleTable
              head={["SO", "Customer", "Item", "Open", "Usable", "Promised"]}
              rows={shipments.map((s) => [
                <Link key="a" href={`/sales/orders/${s.so_id}`} className="font-medium text-primary hover:underline">{s.so_number}</Link>,
                <span key="b" className="text-muted-foreground">{s.customer}</span>,
                s.sku,
                <span key="c" className="tabular">{formatNumber(s.open)}</span>,
                <span key="d" className={cn("tabular", s.usable < s.open && "font-medium text-destructive")}>{formatNumber(s.usable)}</span>,
                <span key="e" className={cn("whitespace-nowrap", s.late && "font-medium text-destructive")}>{formatDate(s.promised_date, { year: false })}</span>,
              ])}
            />
          )}
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title={`Inventory alerts (${alerts.length})`} className="xl:col-span-2">
          <AlertsList alerts={alerts} limit={14} />
        </Panel>
        <Panel title="Recent stock movements" action={<PanelLink href="/inventory/movements">Ledger</PanelLink>} className="xl:col-span-3">
          <SimpleTable
            head={["When", "Type", "Item", "Qty", "Location", "Reference"]}
            rows={movements.map((m) => [
              <span key="a" className="whitespace-nowrap text-muted-foreground">{formatRelative(new Date(m.occurred_at), now)}</span>,
              <ToneBadge key="b" tone={Number(m.quantity) > 0 ? "success" : "neutral"} dot={false}>{m.movement_type.replace(/_/g, " ")}</ToneBadge>,
              <Link key="c" href={`/inventory/items/${m.item_id}`} className="hover:underline">{m.sku}</Link>,
              <span key="d" className={cn("tabular", Number(m.quantity) < 0 ? "text-muted-foreground" : "text-success")}>{Number(m.quantity) > 0 ? "+" : ""}{formatQty(m.quantity)}</span>,
              <span key="e" className="text-muted-foreground">{m.wh}{m.lot_number ? ` · ${m.lot_number}` : ""}</span>,
              <span key="f" className="text-muted-foreground">{m.reference_number ?? "—"}</span>,
            ])}
          />
        </Panel>
      </div>
    </div>
  );
}

async function QualityView({ user, f }: Props) {
  const db = await getDb();
  const [quality, events, holds, inspections] = await Promise.all([
    getQualitySummary(db, user.ctx, f),
    getOpenQualityEvents(db, user.ctx, f),
    getActiveHolds(db, user.ctx),
    getInspectionStats(db, user.ctx, f.range.from, f.range.to),
  ]);
  const passRate = inspections.total ? (inspections.passed / inspections.total) * 100 : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MiniStat label="Open quality events" value={String(events.length)} />
        <MiniStat label="Lots on hold" value={String(holds.length)} sub={`${formatNumber(holds.reduce((s, h) => s + h.qty, 0), 0)} units blocked`} />
        <MiniStat label="Overdue actions" value={String(quality.overdue.length)} danger={quality.overdue.length > 0} />
        <MiniStat label="Inspection pass rate" value={passRate === null ? "—" : `${passRate.toFixed(1)}%`} sub={`${inspections.total} inspections · ${user.range.label.toLowerCase()}`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <QualityPanel quality={quality} className="xl:col-span-2" />
        <Panel title={`Open events (${events.length})`} action={<PanelLink href="/quality">All events</PanelLink>} className="xl:col-span-3">
          {events.length === 0 ? (
            <EmptyState title="No open quality events" className="m-4" />
          ) : (
            <SimpleTable
              head={["Event", "Title", "Severity", "Status", "Due", "Owner"]}
              rows={events.map((e) => [
                <Link key="a" href={`/quality/events/${e.id}`} className="font-medium text-primary hover:underline">{e.event_number}</Link>,
                <span key="b" className="line-clamp-1 max-w-[260px]">{e.title}</span>,
                <SeverityBadge key="c" severity={e.severity} />,
                <StatusBadge key="d" status={e.status} />,
                <span key="e" className={cn("whitespace-nowrap", e.overdue && "font-medium text-destructive")}>{formatDate(e.due_date, { year: false })}</span>,
                <span key="f" className="text-muted-foreground">{e.owner ?? "—"}</span>,
              ])}
            />
          )}
        </Panel>
      </div>
      <Panel title={`Active quality holds (${holds.length})`}>
        {holds.length === 0 ? (
          <EmptyState title="No lots on hold" icon={ShieldAlert} className="m-4" />
        ) : (
          <SimpleTable
            head={["Lot", "Item", "Qty held", "Reason", "Event", "Placed"]}
            rows={holds.map((h) => [
              <Link key="a" href={`/inventory/lots?lot=${encodeURIComponent(h.lot_number)}`} className="font-medium text-primary hover:underline">{h.lot_number}</Link>,
              h.sku,
              <span key="b" className="tabular">{formatNumber(h.qty)}</span>,
              <span key="c" className="line-clamp-2 max-w-[320px] text-muted-foreground">{h.reason}</span>,
              h.event_id ? <Link key="d" href={`/quality/events/${h.event_id}`} className="hover:underline">{h.event_number}</Link> : "—",
              <span key="e" className="whitespace-nowrap text-muted-foreground">{h.placed_by} · {formatRelative(new Date(h.placed_at))}</span>,
            ])}
          />
        )}
      </Panel>
    </div>
  );
}

function MiniStat({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-[13px] font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-2 text-[26px] leading-none font-semibold", danger && "text-destructive")}>{value}</div>
      {sub && <div className="mt-2 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {head.map((h, i) => (
              <th key={h} className={cn("py-2 font-medium", i === 0 ? "pl-4" : "px-2", i === head.length - 1 && "pr-4")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
              {r.map((c, j) => (
                <td key={j} className={cn("py-2", j === 0 ? "pl-4" : "px-2", j === r.length - 1 && "pr-4")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
