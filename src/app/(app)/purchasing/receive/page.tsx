import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Section, SimpleTable } from "@/components/detail";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { listOpenPoLines } from "@/server/queries/purchasing";
import { formatDate, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Receiving" };

export default async function ReceivingPage() {
  const user = await requirePermission("purchasing.view");
  const db = await getDb();
  const lines = await listOpenPoLines(db, user.ctx, user.siteId, user.today);
  const byPo = new Map<string, typeof lines>();
  for (const l of lines) byPo.set(l.po_id, [...(byPo.get(l.po_id) ?? []), l]);
  const canReceive = user.permissions.includes("purchasing.receive");
  return (
    <>
      <PageHeader
        title="Receiving workbench"
        description="Approved purchase order lines awaiting receipt, oldest expected date first. Open an order to post a receipt with lot numbers."
        breadcrumbs={[{ label: "Purchasing", href: "/purchasing" }, { label: "Receiving" }]}
      />
      {byPo.size === 0 ? (
        <EmptyState title="Nothing to receive" description="Approved purchase orders with open quantities will appear here." />
      ) : (
        <div className="space-y-3">
          {[...byPo.values()].map((group) => {
            const first = group[0];
            return (
              <Section
                key={first.po_id}
                title={`${first.po_number} · ${first.supplier}`}
                description={`${group.length} open line${group.length === 1 ? "" : "s"} · ${first.wh}`}
                actions={
                  <>
                    <StatusBadge status={first.status} late={group.some((g) => g.late)} />
                    <Button asChild size="sm" variant={canReceive ? "default" : "outline"}>
                      <Link href={`/purchasing/orders/${first.po_id}`}>{canReceive ? "Receive" : "View"}</Link>
                    </Button>
                  </>
                }
              >
                <SimpleTable
                  head={["Item", "Ordered", "Open", "Tracking", "Expected"]}
                  align={["left", "right", "right", "left", "left"]}
                  rows={group.map((l) => [
                    <div key="i">
                      <span className="font-medium">{l.sku}</span> <span className="text-muted-foreground">{l.name}</span>
                    </div>,
                    formatNumber(l.ordered),
                    <span key="o" className="font-medium">{formatNumber(l.open)}</span>,
                    l.tracking === "none" ? "—" : "Lot required",
                    <span key="e" className={l.late ? "font-medium text-destructive" : ""}>{formatDate(l.expected_date)}</span>,
                  ])}
                />
              </Section>
            );
          })}
        </div>
      )}
    </>
  );
}
