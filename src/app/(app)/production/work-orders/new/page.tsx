import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { itemOptions, warehouseOptions } from "@/server/queries/lookups";
import { WorkOrderForm } from "./wo-form";

export const metadata: Metadata = { title: "Create work order" };

export default async function NewWorkOrderPage({ searchParams }: { searchParams: Promise<{ item?: string; qty?: string }> }) {
  const user = await requirePermission("production.manage");
  const sp = await searchParams;
  const db = await getDb();
  const [items, warehouses, boms] = await Promise.all([
    itemOptions(db, user.ctx, "manufactured"),
    warehouseOptions(db, user.ctx),
    db.query<{ item_id: string }>(`select item_id from boms where organization_id = $1 and status = 'released'`, [user.ctx.orgId]),
  ]);
  const withBom = new Set(boms.map((b) => b.item_id));
  return (
    <>
      <PageHeader title="Create work order" description="Material requirements are calculated from the released BOM revision, including scrap allowances." breadcrumbs={[{ label: "Production", href: "/production" }, { label: "New" }]} />
      <WorkOrderForm
        items={items.map((i) => ({ ...i, hasBom: withBom.has(i.id) }))}
        warehouses={warehouses}
        today={user.today}
        canRelease
        defaultItemId={sp.item}
        defaultQty={sp.qty}
      />
    </>
  );
}
