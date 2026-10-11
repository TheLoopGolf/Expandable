import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, GitBranch } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/detail";
import { SeverityBadge, StatusBadge } from "@/components/status-badge";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { listLots, traceLot } from "@/server/queries/inventory";
import { formatDate, formatNumber } from "@/lib/format";
import { LotTable } from "./lot-table";

export const metadata: Metadata = { title: "Lots & traceability" };

export default async function LotsPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const db = await getDb();
  const [lots, trace] = await Promise.all([listLots(db, user.ctx, user.today), sp.lot ? traceLot(db, user.ctx, sp.lot) : Promise.resolve(null)]);
  return (
    <>
      <PageHeader
        title="Lots & traceability"
        description="Lot status, expiry and holds. Select a lot to trace it backward to suppliers and forward to work orders, output lots and customers."
        breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Lots" }]}
      />
      {sp.lot && !trace && <p className="mb-4 text-sm text-muted-foreground">Lot {sp.lot} was not found in this organization.</p>}
      {trace && (
        <Section
          className="mb-4"
          title={`Traceability: lot ${trace.lot.lot_number} (${trace.lot.sku})`}
          description={`Origin: ${trace.lot.origin}${trace.lot.origin_ref ? ` · ${trace.lot.origin_ref}` : ""}`}
          actions={<StatusBadge status={trace.lot.status} />}
        >
          <div className="grid gap-4 p-4 lg:grid-cols-4">
            <TraceColumn title="Made from (component lots)" empty="Purchased or opening stock — no component genealogy.">
              {trace.madeFrom.map((m, i) => (
                <li key={i}>
                  {formatNumber(m.quantity)} × {m.sku}
                  {m.lot_number && (
                    <>
                      {" · "}
                      <Link href={`/inventory/lots?lot=${encodeURIComponent(m.lot_number)}`} className="font-mono text-primary hover:underline">{m.lot_number}</Link>
                    </>
                  )}
                </li>
              ))}
            </TraceColumn>
            <TraceColumn title="Consumed by work orders" empty="Not issued to production.">
              {trace.consumedBy.map((c) => (
                <li key={c.wo_id}>
                  <Link href={`/production/work-orders/${c.wo_id}`} className="text-primary hover:underline">{c.wo_number}</Link> · {formatNumber(c.quantity)} into {c.sku}
                  {c.output_lots && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowRight className="size-3" /> output lots{" "}
                      {c.output_lots.split(", ").map((lot) => (
                        <Link key={lot} href={`/inventory/lots?lot=${encodeURIComponent(lot)}`} className="font-mono hover:underline">{lot}</Link>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </TraceColumn>
            <TraceColumn title="Shipped to customers" empty="Not shipped.">
              {trace.shipped.map((s) => (
                <li key={s.so_id}>
                  <Link href={`/sales/orders/${s.so_id}`} className="text-primary hover:underline">{s.so_number}</Link> · {s.customer} · {formatNumber(s.quantity)} on {formatDate(s.ship_date, { year: false })}
                </li>
              ))}
            </TraceColumn>
            <TraceColumn title="Quality events" empty="No quality events.">
              {trace.quality.map((q) => (
                <li key={q.id} className="flex flex-wrap items-center gap-1.5">
                  <Link href={`/quality/events/${q.id}`} className="text-primary hover:underline">{q.event_number}</Link>
                  <SeverityBadge severity={q.severity} />
                  <StatusBadge status={q.status} />
                  <span className="w-full text-xs text-muted-foreground">{q.title}</span>
                </li>
              ))}
            </TraceColumn>
          </div>
        </Section>
      )}
      <LotTable rows={lots} canHold={user.permissions.includes("quality.hold")} />
    </>
  );
}

function TraceColumn({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <GitBranch className="size-3.5" /> {title}
      </div>
      {children.length === 0 ? <p className="text-xs text-muted-foreground">{empty}</p> : <ul className="space-y-1.5 text-[13px]">{children}</ul>}
    </div>
  );
}
