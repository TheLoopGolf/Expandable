import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/detail";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { listSalesOrders } from "@/server/queries/sales";
import { getProductFamilies } from "@/server/queries/dashboard";
import { formatCurrency } from "@/lib/format";
import { SalesOrderTable } from "./so-table";

export const metadata: Metadata = { title: "Sales orders" };

export default async function SalesOrdersPage() {
  const user = await requirePermission("sales.view");
  const db = await getDb();
  const [rows, families] = await Promise.all([listSalesOrders(db, user.ctx, user.siteId, user.today), getProductFamilies(db, user.ctx)]);
  const open = rows.filter((r) => r.bucket === "open");
  const customers = [...new Set(rows.map((r) => r.customer))].sort();
  return (
    <>
      <PageHeader
        title="Sales orders"
        description="Customer demand from order entry through reservation, shipment and invoicing."
        breadcrumbs={[{ label: "Commercial" }, { label: "Sales orders" }]}
        actions={
          user.permissions.includes("sales.manage") && (
            <Button asChild size="sm">
              <Link href="/sales/orders/new">
                <Plus /> New sales order
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open orders" value={open.length} sub={`${formatCurrency(open.reduce((s, r) => s + r.openValue, 0), { compact: true })} unshipped`} />
        <StatCard label="Late orders" value={open.filter((r) => r.late).length} tone={open.some((r) => r.late) ? "danger" : undefined} sub="Past promised date" />
        <StatCard label="Partially shipped" value={rows.filter((r) => r.status === "partially_shipped").length} />
        <StatCard label="Drafts" value={rows.filter((r) => r.status === "draft").length} sub="Awaiting confirmation" />
      </div>
      <SalesOrderTable rows={rows} customers={customers} families={families} />
    </>
  );
}
