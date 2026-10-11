import type { Metadata } from "next";
import Link from "next/link";
import { Network } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Section, StatCard } from "@/components/detail";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { listBoms, listEngineeringChanges } from "@/server/queries/engineering";
import { EcoTable, NewEcoDialog } from "./eco-panel";

export const metadata: Metadata = { title: "Engineering" };

export default async function EngineeringPage() {
  const user = await requirePermission("engineering.view");
  const db = await getDb();
  const [boms, ecos, items] = await Promise.all([
    listBoms(db, user.ctx),
    listEngineeringChanges(db, user.ctx),
    db.query<{ id: string; sku: string; name: string; revision: string; lifecycle_status: string }>(
      `select id, sku, name, revision, lifecycle_status from items where organization_id = $1 order by sku`,
      [user.ctx.orgId],
    ),
  ]);
  const can = (p: string) => user.permissions.includes(p as never);
  const costDrift = boms.filter((b) => b.rolledCost !== null && Math.abs(b.rolledCost - b.standardCost) / Math.max(b.standardCost, 0.01) > 0.02);
  return (
    <>
      <PageHeader
        title="Engineering"
        description="Item revisions, bills of materials and engineering change control."
        breadcrumbs={[{ label: "Engineering" }]}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/engineering/boms">
                <Network /> Bills of materials
              </Link>
            </Button>
            {can("engineering.manage") && <NewEcoDialog items={items.filter((i) => i.lifecycle_status !== "obsolete")} />}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Active items" value={items.filter((i) => i.lifecycle_status === "active").length} sub={`${items.length} total`} />
        <StatCard label="Released BOMs" value={boms.filter((b) => b.status === "released").length} />
        <StatCard label="Draft BOM revisions" value={boms.filter((b) => b.status === "draft").length} />
        <StatCard label="Open changes" value={ecos.filter((e) => ["draft", "in_review", "approved"].includes(e.status)).length} />
        <StatCard label="Cost roll-up drift" value={costDrift.length} sub="Rolled cost differs > 2% from standard" tone={costDrift.length ? "danger" : undefined} />
      </div>
      <Section title="Engineering changes" description="Draft → In review → Approved → Implemented. Implementation releases the new BOM revision; released work orders keep their snapshot.">
        <EcoTable rows={ecos.map((e) => ({ ...e, created_at: new Date(e.created_at).toISOString() }))} canManage={can("engineering.manage")} canRelease={can("engineering.release")} />
      </Section>
    </>
  );
}
