import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DetailGrid, Section, SimpleTable } from "@/components/detail";
import { HistoryList } from "@/components/history";
import { SeverityBadge, StatusBadge } from "@/components/status-badge";
import { ReasonActionButton } from "@/components/action-button";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { orNotFound } from "@/server/page-helpers";
import { getQualityEvent } from "@/server/queries/quality";
import { memberOptions } from "@/server/queries/lookups";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { placeHoldOnLotAction } from "../../../inventory/actions";
import { CapaStatusButton, ReleaseHoldButton } from "../../quality-actions";
import { AddCapaDialog, EventStatusDialog } from "./event-actions";

export const metadata: Metadata = { title: "Quality event" };

export default async function QualityEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("quality.view");
  const db = await getDb();
  const { ev, holds, capas, lotQty, history } = await orNotFound(() => getQualityEvent(db, user.ctx, id));
  const members = await memberOptions(db, user.ctx);
  const can = (p: string) => user.permissions.includes(p as never);
  const open = ["open", "investigating", "pending_disposition"].includes(ev.status);
  const activeHold = holds.find((h) => h.status === "active");
  const overdue = open && !!ev.due_date && ev.due_date < user.today;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Quality", href: "/quality" }, { label: ev.event_number }]}
        title={
          <>
            {ev.event_number} <SeverityBadge severity={ev.severity} /> <StatusBadge status={ev.status} />
            {overdue && <StatusBadge status="overdue" />}
          </>
        }
        description={ev.title}
        actions={
          <>
            {open && can("quality.manage") && <EventStatusDialog id={ev.id} status={ev.status} eventType={ev.event_type} disposition={ev.disposition} rootCause={ev.root_cause} />}
            {open && can("quality.manage") && <AddCapaDialog eventId={ev.id} members={members} today={user.today} />}
            {ev.lot_id && !activeHold && ev.lot_status === "available" && can("quality.hold") && (
              <ReasonActionButton title={`Place lot ${ev.lot_number} on hold`} label="Hold reason" minLength={5} action={placeHoldOnLotAction.bind(null, ev.lot_id)}>
                Place lot on hold
              </ReasonActionButton>
            )}
            {ev.lot_number && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/inventory/lots?lot=${encodeURIComponent(ev.lot_number)}`}>Trace lot</Link>
              </Button>
            )}
          </>
        }
      />
      {activeHold && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
          <ShieldAlert className="size-4" />
          <span className="flex-1">
            Lot <strong>{activeHold.lot_number}</strong> is on quality hold ({formatNumber(activeHold.qty)} units): {activeHold.reason}. Issue and shipment from this lot are blocked.
          </span>
          {can("quality.hold") && <ReleaseHoldButton holdId={activeHold.id} lotNumber={activeHold.lot_number} reason={activeHold.reason} />}
        </div>
      )}
      <div className="space-y-4">
        <div className="rounded-xl border bg-card p-4">
          <DetailGrid
            items={[
              { label: "Type", value: ev.event_type.replace("_", " ").toUpperCase() === "NCR" ? "NCR" : ev.event_type.replace("_", " ") },
              { label: "Source", value: <span className="capitalize">{ev.source.replace("_", "-")}</span> },
              { label: "Owner", value: ev.owner ?? "—" },
              { label: "Due", value: <span className={overdue ? "text-destructive" : ""}>{formatDate(ev.due_date)}</span> },
              { label: "Opened", value: `${ev.opened_by ?? "—"}, ${formatDateTime(ev.opened_at, user.org.timezone)}` },
              { label: "Closed", value: ev.closed_at ? `${ev.closed_by}, ${formatDateTime(ev.closed_at, user.org.timezone)}` : "—" },
              { label: "Item", value: ev.item_id ? <Link href={`/inventory/items/${ev.item_id}`} className="hover:underline">{ev.sku}</Link> : "—" },
              { label: "Lot", value: ev.lot_number ? <Link href={`/inventory/lots?lot=${encodeURIComponent(ev.lot_number)}`} className="hover:underline">{ev.lot_number}</Link> : "—" },
              { label: "Qty affected", value: ev.quantity_affected ? formatNumber(ev.quantity_affected) : "—" },
              { label: "Work order", value: ev.wo_id ? <Link href={`/production/work-orders/${ev.wo_id}`} className="hover:underline">{ev.wo_number}</Link> : "—" },
              { label: "Purchase order", value: ev.po_id ? <Link href={`/purchasing/orders/${ev.po_id}`} className="hover:underline">{ev.po_number}</Link> : "—" },
              { label: "Sales order", value: ev.so_id ? <Link href={`/sales/orders/${ev.so_id}`} className="hover:underline">{ev.so_number}</Link> : "—" },
              { label: "Supplier", value: ev.supplier ?? "—" },
              { label: "Customer", value: ev.customer ?? "—" },
              { label: "Disposition", value: ev.disposition ? ev.disposition.replace(/_/g, " ") : "—" },
              { label: "Lot location", value: lotQty.length ? lotQty.map((l) => `${l.wh} ${formatNumber(l.qty)}`).join(", ") : "—" },
            ]}
          />
          {(ev.description || ev.root_cause || ev.closure_notes) && (
            <div className="mt-3 grid gap-3 border-t pt-3 text-[13px] md:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">Description</div>
                <p className="mt-0.5 whitespace-pre-line">{ev.description ?? "—"}</p>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Root cause</div>
                <p className="mt-0.5 whitespace-pre-line">{ev.root_cause ?? "—"}</p>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Closure notes</div>
                <p className="mt-0.5 whitespace-pre-line">{ev.closure_notes ?? "—"}</p>
              </div>
            </div>
          )}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Section title={`CAPA (${capas.length})`}>
            <SimpleTable
              head={["CAPA", "Action", "Owner", "Due", "Status", ""]}
              empty="No corrective or preventive actions."
              rows={capas.map((c) => [
                <span key="n" className="font-medium">{c.capa_number}</span>,
                <div key="d" className="max-w-[280px]">
                  <span className="text-xs capitalize text-muted-foreground">{c.action_type}: </span>
                  {c.description}
                  {c.verification_notes && <div className="text-xs text-muted-foreground">Verification: {c.verification_notes}</div>}
                </div>,
                c.owner ?? "—",
                <span key="du" className={["open", "in_progress"].includes(c.status) && c.due_date < user.today ? "font-medium text-destructive" : ""}>{formatDate(c.due_date, { year: false })}</span>,
                <StatusBadge key="s" status={c.status} />,
                can("quality.manage") && c.status !== "closed" ? <CapaStatusButton key="a" id={c.id} number={c.capa_number} status={c.status} /> : null,
              ])}
            />
          </Section>
          <Section title="Hold history">
            <SimpleTable
              head={["Lot", "Status", "Reason", "Placed", "Released"]}
              empty="No holds."
              rows={holds.map((h) => [
                h.lot_number,
                <StatusBadge key="s" status={h.status === "active" ? "hold" : "released"} />,
                <span key="r" className="text-xs">{h.reason}</span>,
                <span key="p" className="text-xs text-muted-foreground">{h.placed_by} · {formatDateTime(h.placed_at, user.org.timezone)}</span>,
                h.released_at ? (
                  <span key="x" className="text-xs text-muted-foreground">
                    {h.released_by} · {formatDateTime(h.released_at, user.org.timezone)}
                    <br />“{h.release_reason}”
                  </span>
                ) : "—",
              ])}
            />
          </Section>
        </div>
        <Section title="Audit history (event and lot)">
          <HistoryList items={history} timeZone={user.org.timezone} />
        </Section>
      </div>
    </>
  );
}
