import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { orNotFound } from "@/server/page-helpers";
import { NotFoundError } from "@/server/errors";
import { supplierOptions, warehouseOptions } from "@/server/queries/lookups";
import { ItemForm } from "../../item-form";

export const metadata: Metadata = { title: "Edit item" };

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("items.manage");
  const db = await getDb();
  const item = await orNotFound(async () => {
    const [row] = await db.query<Record<string, string | number | null>>(`select * from items where id = $1 and organization_id = $2`, [id, user.ctx.orgId]);
    if (!row) throw new NotFoundError("Item");
    return row;
  });
  const [suppliers, warehouses, meta] = await Promise.all([
    supplierOptions(db, user.ctx),
    warehouseOptions(db, user.ctx),
    db.query<{ category: string; product_family: string | null }>(`select distinct category, product_family from items where organization_id = $1`, [user.ctx.orgId]),
  ]);
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return (
    <>
      <PageHeader title={`Edit ${item.sku}`} description="Changes are recorded in the audit trail with before and after values." breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: String(item.sku), href: `/inventory/items/${id}` }, { label: "Edit" }]} />
      <ItemForm
        itemId={id}
        suppliers={suppliers}
        warehouses={warehouses}
        categories={[...new Set(meta.map((m) => m.category))].sort()}
        families={[...new Set(meta.map((m) => m.product_family).filter((f): f is string => !!f))].sort()}
        defaults={{
          sku: s(item.sku),
          name: s(item.name),
          description: s(item.description),
          itemType: item.item_type as "purchased" | "manufactured",
          category: s(item.category),
          productFamily: s(item.product_family),
          uom: s(item.uom),
          standardCost: s(item.standard_cost),
          listPrice: s(item.list_price),
          preferredSupplierId: s(item.preferred_supplier_id),
          leadTimeDays: Number(item.lead_time_days),
          reorderPoint: s(item.reorder_point),
          safetyStock: s(item.safety_stock),
          minOrderQty: s(item.min_order_qty),
          tracking: item.tracking as "none" | "lot" | "serial",
          shelfLifeDays: item.shelf_life_days === null ? undefined : Number(item.shelf_life_days),
          defaultWarehouseId: s(item.default_warehouse_id),
          lifecycleStatus: item.lifecycle_status as "draft" | "active" | "hold" | "obsolete",
        }}
      />
    </>
  );
}
