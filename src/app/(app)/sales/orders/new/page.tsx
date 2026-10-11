import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { customerOptions, itemOptions, warehouseOptions } from "@/server/queries/lookups";
import { SalesOrderForm } from "./so-form";

export const metadata: Metadata = { title: "New sales order" };

export default async function NewSalesOrderPage() {
  const user = await requirePermission("sales.manage");
  const db = await getDb();
  const [customers, warehouses, items] = await Promise.all([customerOptions(db, user.ctx), warehouseOptions(db, user.ctx), itemOptions(db, user.ctx, "manufactured")]);
  const sellable = items.filter((i) => i.list_price !== null);
  const shipFrom = warehouses.filter((w) => w.kind !== "stores" && (!user.siteId || w.site_id === user.siteId));
  return (
    <>
      <PageHeader
        title="New sales order"
        description="Available-to-promise is shown per line from usable stock, open commitments and scheduled supply."
        breadcrumbs={[{ label: "Sales orders", href: "/sales/orders" }, { label: "New" }]}
      />
      <SalesOrderForm customers={customers} warehouses={shipFrom.length ? shipFrom : warehouses} items={sellable} today={user.today} defaultWarehouseId={(shipFrom[0] ?? warehouses[0])?.id ?? ""} />
    </>
  );
}
