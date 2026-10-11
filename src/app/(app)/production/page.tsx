import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/detail";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { listWorkOrders } from "@/server/queries/production";
import { getProductFamilies } from "@/server/queries/dashboard";
import { WorkOrderTable } from "./wo-table";

export const metadata: Metadata = { title: "Production" };

export default async function ProductionPage() {
  const user = await requirePermission("production.view");
  const db = await getDb();
  const [rows, families] = await Promise.all([listWorkOrders(db, user.ctx, user.siteId, user.today), getProductFamilies(db, user.ctx)]);
  const open = rows.filter((r) => r.scope === "open");
  const centers = [...new Set(rows.map((r) => r.workCenter).filter(Boolean))].sort();
  return (
    <>
      <PageHeader
        title="Production"
        description="Work orders from release through material issue, output recording and close."
        breadcrumbs={[{ label: "Operations" }, { label: "Production" }]}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/production/schedule">
                <CalendarRange /> Schedule board
              </Link>
            </Button>
            {user.permissions.includes("production.manage") && (
              <Button asChild size="sm">
                <Link href="/production/work-orders/new">
                  <Plus /> Create work order
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Open work orders" value={open.length} />
        <StatCard label="Late" value={open.filter((r) => r.late).length} tone={open.some((r) => r.late) ? "danger" : undefined} sub="Past due date" />
        <StatCard label="Blocked" value={open.filter((r) => r.blocker).length} sub="Hold or material shortage" />
        <StatCard label="Drafts" value={rows.filter((r) => r.status === "draft").length} sub="Not yet released" />
        <StatCard label="Awaiting close" value={rows.filter((r) => r.status === "completed").length} sub="Completed, variance not posted" />
      </div>
      <WorkOrderTable rows={rows} families={families} centers={centers} />
    </>
  );
}
