import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { itemOptions, supplierOptions, warehouseOptions } from "@/server/queries/lookups";
import { PurchaseOrderForm } from "./po-form";

export const metadata: Metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<{ supplier?: string; item?: string; qty?: string }> }) {
  const user = await requirePermission("purchasing.manage");
  const sp = await searchParams;
  const db = await getDb();
  const [suppliers, warehouses, items] = await Promise.all([supplierOptions(db, user.ctx), warehouseOptions(db, user.ctx), itemOptions(db, user.ctx, "purchased")]);
  const scoped = user.siteId ? warehouses.filter((w) => w.site_id === user.siteId) : warehouses;
  return (
    <>
      <PageHeader
        title="New purchase order"
        description="Draft orders can be edited and must be approved before receiving."
        breadcrumbs={[{ label: "Purchasing", href: "/purchasing" }, { label: "New" }]}
      />
      <PurchaseOrderForm
        suppliers={suppliers}
        warehouses={scoped.length ? scoped : warehouses}
        items={items}
        today={user.today}
        canApprove={user.permissions.includes("purchasing.approve")}
        defaults={{ supplierId: sp.supplier, itemId: sp.item, quantity: sp.qty }}
      />
    </>
  );
}
