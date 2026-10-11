import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DetailGrid, Section, SimpleTable, StatCard } from "@/components/detail";
import { HistoryList } from "@/components/history";
import { StatusBadge } from "@/components/status-badge";
import { ActionButton } from "@/components/action-button";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { orNotFound } from "@/server/page-helpers";
import { getBom } from "@/server/queries/engineering";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { releaseBomAction } from "../../actions";
import { BomTree } from "../bom-tree";
import { EditBomLines, NewRevisionButton } from "../bom-editor";

export const metadata: Metadata = { title: "Bill of materials" };

export default async function BomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("engineering.view");
  const db = await getDb();
  const data = await orNotFound(() => getBom(db, user.ctx, id));
  const { bom, lines, tree, error, cost, usedIn, revisions, changes, components, history } = data;
  const can = (p: string) => user.permissions.includes(p as never);
  const drift = cost.standard > 0 ? ((cost.total - cost.standard) / cost.standard) * 100 : 0;
  const nextRev = /^[A-Y]$/.test(bom.revision) ? String.fromCharCode(bom.revision.charCodeAt(0) + 1) : `${bom.revision}.1`;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Bills of materials", href: "/engineering/boms" }, { label: `${bom.sku} rev ${bom.revision}` }]}
        title={
          <>
            {bom.sku} <span className="text-muted-foreground">rev {bom.revision}</span> <StatusBadge status={bom.status} />
          </>
        }
        description={bom.name}
        actions={
          <>
            {bom.status === "draft" && can("engineering.release") && (
              <ActionButton action={releaseBomAction.bind(null, bom.id)} confirm={{ title: `Release ${bom.sku} rev ${bom.revision}?`, description: "It becomes the effective BOM for new work orders and the previous released revision is obsoleted. Existing work orders keep their snapshot.", confirmLabel: "Release" }}>
                Release
              </ActionButton>
            )}
            {bom.status === "released" && can("engineering.manage") && <NewRevisionButton bomId={bom.id} suggested={nextRev} />}
          </>
        }
      />
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4" /> {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Rolled material cost" value={formatCurrency(cost.material, { cents: true })} sub="Per unit, incl. scrap allowance" />
          <StatCard label="Labor & overhead" value={formatCurrency(cost.labor, { cents: true })} sub="Routing hours × work-center rate" />
          <StatCard label="Rolled total" value={formatCurrency(cost.total, { cents: true })} />
          <StatCard label="Item standard cost" value={formatCurrency(cost.standard, { cents: true })} sub={`${drift >= 0 ? "+" : ""}${drift.toFixed(1)}% rolled vs standard`} tone={Math.abs(drift) > 2 ? "danger" : undefined} />
        </div>
        <div className="rounded-xl border bg-card p-4">
          <DetailGrid
            items={[
              { label: "Assembly", value: <Link href={`/inventory/items/${bom.item_id}`} className="hover:underline">{bom.sku}</Link> },
              { label: "Effective from", value: formatDate(bom.effective_from) },
              { label: "Effective to", value: formatDate(bom.effective_to) },
              { label: "Created by", value: bom.created_by ?? "—" },
              { label: "Released", value: bom.released_at ? `${bom.released_by}, ${formatDateTime(bom.released_at, user.org.timezone)}` : "—" },
              { label: "Notes", value: bom.notes ?? "—" },
            ]}
          />
        </div>
        {bom.status === "draft" && can("engineering.manage") ? (
          <Section title="Edit components (draft)" description="Changes apply only to this draft revision.">
            <EditBomLines
              bomId={bom.id}
              components={components}
              initial={lines.map((l) => ({ componentItemId: l.component_item_id, quantityPer: String(Number(l.quantity_per)), scrapPct: String(Number(l.scrap_pct)), reference: l.reference ?? "" }))}
            />
          </Section>
        ) : null}
        <Section title="Multi-level structure" description="This revision at the top level; released revisions below. Quantities are per one assembly.">
          <BomTree nodes={tree} />
        </Section>
        <div className="grid gap-4 xl:grid-cols-3">
          <Section title="Where used">
            <SimpleTable head={["Assembly", "Level"]} empty="Top-level assembly (not used in other BOMs)." rows={usedIn.map((u) => [<Link key="a" href={`/inventory/items/${u.assemblyId}`} className="hover:underline">{u.sku} — {u.name}</Link>, u.level])} />
          </Section>
          <Section title="Revisions">
            <SimpleTable
              head={["Rev", "Status", "Effective"]}
              rows={revisions.map((r) => [
                r.id === bom.id ? <span key="r" className="font-semibold">{r.revision}</span> : <Link key="r" href={`/engineering/boms/${r.id}`} className="hover:underline">{r.revision}</Link>,
                <StatusBadge key="s" status={r.status} />,
                <span key="e" className="text-xs text-muted-foreground">{formatDate(r.effective_from)}{r.effective_to ? ` – ${formatDate(r.effective_to)}` : ""}</span>,
              ])}
            />
          </Section>
          <Section title="Engineering changes">
            <SimpleTable head={["Change", "Status"]} empty="No changes." rows={changes.map((c) => [<Link key="c" href="/engineering" className="hover:underline">{c.change_number} · {c.title}</Link>, <StatusBadge key="s" status={c.status} />])} />
          </Section>
        </div>
        <Section title="Line detail">
          <SimpleTable
            head={["Line", "Component", "Qty per", "Scrap %", "Unit cost", "Ext. cost", "Reference"]}
            align={["left", "left", "right", "right", "right", "right", "left"]}
            rows={lines.map((l) => [l.line_no, `${l.sku} — ${l.name}`, formatNumber(l.quantity_per, 4), formatNumber(l.scrap_pct, 2), formatCurrency(l.unitCost, { cents: true }), formatCurrency(l.extendedCost, { cents: true }), l.reference ?? ""])}
          />
        </Section>
        <Section title="History">
          <HistoryList items={history} timeZone={user.org.timezone} />
        </Section>
      </div>
    </>
  );
}
