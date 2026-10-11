import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DetailGrid, Section, SimpleTable, StatCard } from "@/components/detail";
import { HistoryList } from "@/components/history";
import { StatusBadge, ToneBadge } from "@/components/status-badge";
import { ActionButton, ReasonActionButton } from "@/components/action-button";
import { Progress } from "@/components/ui/progress";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { orNotFound } from "@/server/page-helpers";
import { getWorkOrder } from "@/server/queries/production";
import { formatCurrency, formatDate, formatDateTime, formatNumber, toNum } from "@/lib/format";
import type { Tone } from "@/lib/status";
import {
  cancelWorkOrderAction,
  closeWorkOrderAction,
  completeOperationAction,
  holdWorkOrderAction,
  reallocateWorkOrderAction,
  releaseWorkOrderAction,
  resumeWorkOrderAction,
} from "../../actions";
import { IssueDialog, RecordProductionDialog } from "./dialogs";

export const metadata: Metadata = { title: "Work order" };

const READINESS_TONE: Record<string, Tone> = { issued: "success", ready: "success", partial: "warning", short: "danger", blocked: "danger" };
const READINESS_LABEL: Record<string, string> = { issued: "Issued", ready: "Ready", partial: "Partial", short: "Short", blocked: "Blocked (hold)" };

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("production.view");
  const db = await getDb();
  const { wo, readiness, operations, issues, receipts, lots, materialIssuedValue, history, bins } = await orNotFound(() => getWorkOrder(db, user.ctx, id));
  const can = (p: string) => user.permissions.includes(p as never);
  const planned = toNum(wo.quantity_planned);
  const completed = toNum(wo.quantity_completed);
  const scrapped = toNum(wo.quantity_scrapped);
  const remaining = planned - completed - scrapped;
  const open = ["released", "in_progress", "on_hold"].includes(wo.status);
  const late = open && wo.due_date < user.today;
  const executable = ["released", "in_progress"].includes(wo.status);
  const toIssue = readiness.filter((r) => toNum(r.remaining) > 0);
  // How many more units the issued material supports (per-unit requirement from the snapshot).
  const supported = readiness.length
    ? Math.min(...readiness.map((r) => (toNum(r.required) > 0 ? (toNum(r.issued) / toNum(r.required)) * planned : Infinity))) - (completed + scrapped)
    : remaining;
  const ready = readiness.every((r) => r.status === "ready" || r.status === "issued");
  const estCost = toNum(wo.estimated_unit_cost) * planned;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Production", href: "/production" }, { label: wo.wo_number }]}
        title={
          <>
            {wo.wo_number} <StatusBadge status={wo.status} late={late} />
            {wo.priority !== "normal" && <StatusBadge status={wo.priority} />}
            {wo.source === "mrp" && <ToneBadge tone="info" dot={false}>From MRP</ToneBadge>}
          </>
        }
        description={`${formatNumber(planned)} × ${wo.sku} — ${wo.name}`}
        actions={
          <>
            {wo.status === "draft" && can("production.manage") && (
              <ActionButton action={releaseWorkOrderAction.bind(null, wo.id)} confirm={{ title: `Release ${wo.wo_number}?`, description: "Released orders freeze their BOM snapshot for execution and allocate available material.", confirmLabel: "Release" }}>
                Release
              </ActionButton>
            )}
            {executable && can("production.execute") && toIssue.length > 0 && <IssueDialog woId={wo.id} woNumber={wo.wo_number} lines={toIssue.map((r) => ({ materialId: r.materialId, lineNo: r.lineNo, itemId: r.itemId, sku: r.sku, uom: r.uom, tracking: r.tracking, remaining: toNum(r.remaining), availableForOrder: toNum(r.availableForOrder), heldOnHand: toNum(r.heldOnHand) }))} lots={lots} today={user.today} />}
            {executable && can("production.execute") && remaining > 0 && <RecordProductionDialog woId={wo.id} woNumber={wo.wo_number} remaining={remaining} tracking={wo.tracking} bins={bins} maxByMaterial={Math.max(0, supported)} />}
            {executable && can("production.manage") && (
              <ReasonActionButton title={`Put ${wo.wo_number} on hold`} description="Holds block material issue and output until resumed." action={holdWorkOrderAction.bind(null, wo.id)} confirmLabel="Place on hold">
                Hold
              </ReasonActionButton>
            )}
            {wo.status === "on_hold" && can("production.manage") && <ActionButton action={resumeWorkOrderAction.bind(null, wo.id)}>Resume</ActionButton>}
            {open && can("production.manage") && wo.status !== "on_hold" && (
              <ActionButton variant="ghost" action={reallocateWorkOrderAction.bind(null, wo.id)}>Re-allocate</ActionButton>
            )}
            {wo.status === "completed" && can("production.manage") && (
              <ActionButton action={closeWorkOrderAction.bind(null, wo.id)} confirm={{ title: `Close ${wo.wo_number}?`, description: "Posts any remaining work-in-process balance to production variance. Closed orders cannot be reopened." }}>
                Close
              </ActionButton>
            )}
            {["in_progress", "released"].includes(wo.status) && can("production.manage") && (completed > 0 || issues.length > 0) && (
              <ReasonActionButton title={`Short-close ${wo.wo_number}`} description={`Closes the order with ${formatNumber(remaining)} units not produced and posts the WIP variance.`} action={closeWorkOrderAction.bind(null, wo.id)}>
                Short-close
              </ReasonActionButton>
            )}
            {["draft", "released", "on_hold"].includes(wo.status) && issues.length === 0 && can("production.manage") && (
              <ReasonActionButton title={`Cancel ${wo.wo_number}`} action={cancelWorkOrderAction.bind(null, wo.id)} confirmLabel="Cancel order" destructive>
                Cancel
              </ReasonActionButton>
            )}
          </>
        }
      />
      {wo.status === "on_hold" && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> On hold: {wo.hold_reason}
        </div>
      )}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Progress" value={`${planned ? (((completed + scrapped) / planned) * 100).toFixed(0) : 0}%`} sub={<Progress value={planned ? ((completed + scrapped) / planned) * 100 : 0} className="mt-1.5 h-1.5" aria-label="Progress" />} />
          <StatCard label="Good / scrap" value={`${formatNumber(completed)} / ${formatNumber(scrapped)}`} sub={`${formatNumber(remaining)} remaining`} />
          <StatCard label="Material readiness" value={ready ? "Ready" : "Not ready"} tone={ready ? "success" : "danger"} sub={`${readiness.filter((r) => r.status === "ready" || r.status === "issued").length}/${readiness.length} lines`} />
          <StatCard label="Estimated cost" value={formatCurrency(estCost)} sub={`${formatCurrency(wo.estimated_unit_cost, { cents: true })}/unit (std ${formatCurrency(wo.standard_cost, { cents: true })})`} />
          <StatCard label="Material issued" value={formatCurrency(materialIssuedValue)} sub="At component standard cost" />
        </div>
        <div className="rounded-xl border bg-card p-4">
          <DetailGrid
            items={[
              { label: "Item", value: <Link href={`/inventory/items/${wo.item_id}`} className="hover:underline">{wo.sku}</Link> },
              { label: "BOM revision", value: wo.bom_id ? <Link href={`/engineering/boms/${wo.bom_id}`} className="hover:underline">Rev {wo.bom_revision} (snapshot)</Link> : "—" },
              { label: "Planned start", value: formatDate(wo.planned_start) },
              { label: "Due", value: <span className={late ? "text-destructive" : ""}>{formatDate(wo.due_date)}</span> },
              { label: "Line", value: wo.wc ?? "—" },
              { label: "Warehouses", value: `${wo.mat_wh} → ${wo.wh}` },
              { label: "Site", value: wo.site },
              { label: "Started", value: formatDateTime(wo.actual_start, user.org.timezone) },
              { label: "Finished", value: formatDateTime(wo.actual_end, user.org.timezone) },
              { label: "Released by", value: wo.released_by ?? "—" },
              { label: "Sales order", value: wo.so_id ? <Link href={`/sales/orders/${wo.so_id}`} className="hover:underline">{wo.so_number}</Link> : "Make to stock" },
              { label: "Created by", value: wo.created_by ?? "—" },
            ]}
          />
          {wo.notes && <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">{wo.notes}</p>}
        </div>
        <Section title="Material readiness" description={`From the frozen BOM rev ${wo.bom_revision ?? "—"} snapshot. Available = usable stock in ${wo.mat_wh} not committed to other orders, plus this order's allocation.`}>
          <SimpleTable
            head={["Component", "Qty/unit", "Required", "Issued", "Remaining", "Allocated", "Usable", "On hold", "Available", "Status"]}
            align={["left", "right", "right", "right", "right", "right", "right", "right", "right", "left"]}
            rows={readiness.map((r) => [
              <div key="c">
                <Link href={`/inventory/items/${r.itemId}`} className="font-medium hover:underline">{r.sku}</Link>
                <div className="text-xs text-muted-foreground">{r.name}</div>
              </div>,
              formatNumber(r.quantityPer, 4),
              formatNumber(r.required),
              formatNumber(r.issued),
              formatNumber(r.remaining),
              formatNumber(r.allocated),
              formatNumber(r.usableOnHand),
              toNum(r.heldOnHand) > 0 ? <span key="h" className="text-amber-700 dark:text-amber-300">{formatNumber(r.heldOnHand)}</span> : "0",
              formatNumber(r.availableForOrder),
              <span key="s" className="flex flex-col gap-0.5">
                <ToneBadge tone={READINESS_TONE[r.status]}>{READINESS_LABEL[r.status]}</ToneBadge>
                {r.status !== "issued" && r.status !== "ready" && <span className="text-xs text-muted-foreground">{r.note}</span>}
              </span>,
            ])}
          />
        </Section>
        <div className="grid gap-4 xl:grid-cols-2">
          <Section title="Operations (routing)">
            <SimpleTable
              head={["Seq", "Operation", "Work center", "Planned h", "Status", ""]}
              align={["left", "left", "left", "right", "left", "left"]}
              empty="No routing defined for this item."
              rows={operations.map((o) => [
                o.seq,
                o.description,
                o.wc,
                formatNumber(o.planned_hours, 2),
                o.status === "done" ? (
                  <span key="d" className="inline-flex items-center gap-1 text-xs text-success"><CircleCheck className="size-3.5" /> Done</span>
                ) : (
                  <StatusBadge key="s" status={o.status} />
                ),
                o.status !== "done" && executable && can("production.execute") ? (
                  <ActionButton key="a" size="xs" variant="outline" action={completeOperationAction.bind(null, o.id)}>Complete</ActionButton>
                ) : null,
              ])}
            />
          </Section>
          <Section title="BOM snapshot" description={wo.bom_snapshot ? `Captured ${formatDateTime(wo.bom_snapshot.capturedAt, user.org.timezone)}; later BOM changes do not alter this order.` : undefined}>
            <SimpleTable
              head={["Line", "Component", "Qty/unit", "Scrap %"]}
              align={["left", "left", "right", "right"]}
              rows={(wo.bom_snapshot?.lines ?? []).map((l) => [l.lineNo, `${l.sku} — ${l.name}`, formatNumber(l.quantityPer, 4), formatNumber(l.scrapPct, 2)])}
            />
          </Section>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Section title={`Material issues (${issues.length})`}>
            <SimpleTable
              head={["Component", "Qty", "Lot", "When"]}
              align={["left", "right", "left", "left"]}
              empty="No material issued yet."
              rows={issues.map((i) => [
                i.sku,
                formatNumber(i.quantity),
                i.lot_number ? <Link key="l" href={`/inventory/lots?lot=${encodeURIComponent(i.lot_number)}`} className="hover:underline">{i.lot_number}</Link> : "—",
                <span key="w" className="text-xs text-muted-foreground">{i.issued_by} · {formatDateTime(i.issued_at, user.org.timezone)}</span>,
              ])}
            />
          </Section>
          <Section title={`Production receipts (${receipts.length})`}>
            <SimpleTable
              head={["Good", "Scrap", "Lot", "Notes", "When"]}
              align={["right", "right", "left", "left", "left"]}
              empty="No output recorded yet."
              rows={receipts.map((r) => [
                formatNumber(r.quantity_good),
                formatNumber(r.quantity_scrap),
                r.lot_number ? <Link key="l" href={`/inventory/lots?lot=${encodeURIComponent(r.lot_number)}`} className="hover:underline">{r.lot_number}</Link> : "—",
                <span key="n" className="text-xs text-muted-foreground">{r.notes ?? ""}</span>,
                <span key="w" className="text-xs text-muted-foreground">{r.recorded_by} · {formatDateTime(r.recorded_at, user.org.timezone)}</span>,
              ])}
            />
          </Section>
        </div>
        <Section title="History">
          <HistoryList items={history} timeZone={user.org.timezone} />
        </Section>
      </div>
    </>
  );
}
