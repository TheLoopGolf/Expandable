import type { Metadata } from "next";
import Link from "next/link";
import { PackageCheck, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/detail";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { listPurchaseOrders } from "@/server/queries/purchasing";
import { supplierOptions } from "@/server/queries/lookups";
import { formatCurrency } from "@/lib/format";
import { PurchaseOrderTable } from "./po-table";

export const metadata: Metadata = { title: "Purchasing" };

export default async function PurchasingPage() {
  const user = await requirePermission("purchasing.view");
  const db = await getDb();
  const [rows, suppliers] = await Promise.all([listPurchaseOrders(db, user.ctx, user.siteId, user.today), supplierOptions(db, user.ctx)]);
  const open = rows.filter((r) => ["approved", "partially_received"].includes(r.status));
  const openValue = open.reduce((s, r) => s + r.total * (1 - r.receivedPct / 100), 0);
  const can = (p: string) => user.permissions.includes(p as never);
  return (
    <>
      <PageHeader
        title="Purchasing"
        description="Purchase orders, approvals and receiving against supplier commitments."
        breadcrumbs={[{ label: "Commercial" }, { label: "Purchasing" }]}
        actions={
          <>
            {can("purchasing.receive") && (
              <Button asChild variant="outline" size="sm">
                <Link href="/purchasing/receive">
                  <PackageCheck /> Receiving
                </Link>
              </Button>
            )}
            {can("purchasing.manage") && (
              <Button asChild size="sm">
                <Link href="/purchasing/orders/new">
                  <Plus /> New purchase order
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open purchase orders" value={open.length} sub={`${formatCurrency(openValue, { compact: true })} not yet received`} />
        <StatCard label="Late inbound" value={open.filter((r) => r.late).length} tone={open.some((r) => r.late) ? "danger" : undefined} sub="Past expected date" />
        <StatCard label="Awaiting approval" value={rows.filter((r) => r.status === "draft").length} sub="Draft orders" />
        <StatCard label="From MRP" value={rows.filter((r) => r.source === "mrp").length} sub="Created from approved suggestions" />
      </div>
      <PurchaseOrderTable rows={rows} suppliers={suppliers} />
    </>
  );
}
