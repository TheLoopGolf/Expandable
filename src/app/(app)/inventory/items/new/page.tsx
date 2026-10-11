import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { supplierOptions, warehouseOptions } from "@/server/queries/lookups";
import { ItemForm } from "../item-form";

export const metadata: Metadata = { title: "New item" };

export default async function NewItemPage() {
  const user = await requirePermission("items.manage");
  const db = await getDb();
  const [suppliers, warehouses, meta] = await Promise.all([
    supplierOptions(db, user.ctx),
    warehouseOptions(db, user.ctx),
    db.query<{ category: string; product_family: string | null }>(`select distinct category, product_family from items where organization_id = $1`, [user.ctx.orgId]),
  ]);
  return (
    <>
      <PageHeader title="New item" breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "New item" }]} />
      <ItemForm
        suppliers={suppliers}
        warehouses={warehouses}
        categories={[...new Set(meta.map((m) => m.category))].sort()}
        families={[...new Set(meta.map((m) => m.product_family).filter((f): f is string => !!f))].sort()}
      />
    </>
  );
}
