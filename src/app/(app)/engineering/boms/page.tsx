import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SimpleTable } from "@/components/detail";
import { StatusBadge } from "@/components/status-badge";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { listBoms } from "@/server/queries/engineering";
import { formatCurrency, formatDate } from "@/lib/format";
import { NewBomDialog } from "./bom-editor";

export const metadata: Metadata = { title: "Bills of materials" };

export default async function BomsPage() {
  const user = await requirePermission("engineering.view");
  const db = await getDb();
  const [boms, items] = await Promise.all([
    listBoms(db, user.ctx),
    db.query<{ id: string; sku: string; name: string; item_type: string }>(`select id, sku, name, item_type from items where organization_id = $1 and lifecycle_status <> 'obsolete' order by sku`, [user.ctx.orgId]),
  ]);
  const withBom = new Set(boms.map((b) => b.item_id));
  return (
    <>
      <PageHeader
        title="Bills of materials"
        description="Versioned multi-level BOMs. One released revision per assembly; rolled cost = component standard costs × quantity (incl. scrap) + routing labor."
        breadcrumbs={[{ label: "Engineering", href: "/engineering" }, { label: "Bills of materials" }]}
        actions={
          user.permissions.includes("engineering.manage") ? (
            <NewBomDialog items={items.filter((i) => i.item_type === "manufactured" && !withBom.has(i.id))} components={items} />
          ) : null
        }
      />
      <div className="rounded-xl border bg-card">
        <SimpleTable
          head={["Assembly", "Rev", "Status", "Components", "Effective", "Rolled cost", "Std cost", "Work orders"]}
          align={["left", "left", "left", "right", "left", "right", "right", "right"]}
          rows={boms.map((b) => [
            <div key="a">
              <Link href={`/engineering/boms/${b.id}`} className="font-medium text-primary hover:underline">{b.sku}</Link>
              <div className="text-xs text-muted-foreground">{b.name}</div>
            </div>,
            b.revision,
            <StatusBadge key="s" status={b.status} />,
            b.lines,
            <span key="e" className="text-xs text-muted-foreground">{formatDate(b.effective_from)}{b.effective_to ? ` – ${formatDate(b.effective_to)}` : ""}</span>,
            b.rolledCost === null ? "—" : formatCurrency(b.rolledCost, { cents: true }),
            formatCurrency(b.standardCost, { cents: true }),
            b.wos,
          ])}
        />
      </div>
    </>
  );
}
