import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { customerOptions, itemOptions, lotOptions, memberOptions, supplierOptions } from "@/server/queries/lookups";
import { NcrForm } from "./ncr-form";

export const metadata: Metadata = { title: "Open nonconformance" };

export default async function NewNcrPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  const user = await requirePermission("quality.manage");
  const sp = await searchParams;
  const db = await getDb();
  const [items, lots, members, suppliers, customers, workOrders] = await Promise.all([
    itemOptions(db, user.ctx),
    lotOptions(db, user.ctx),
    memberOptions(db, user.ctx),
    supplierOptions(db, user.ctx),
    customerOptions(db, user.ctx),
    db.query<{ id: string; wo_number: string; sku: string }>(
      `select wo.id, wo.wo_number, i.sku from work_orders wo join items i on i.id = wo.item_id where wo.organization_id = $1 and wo.created_at > now() - interval '120 days' order by wo.wo_number desc`,
      [user.ctx.orgId],
    ),
  ]);
  return (
    <>
      <PageHeader title="Open nonconformance" description="Record the issue, link the affected lot/order and optionally place the lot on hold in the same transaction." breadcrumbs={[{ label: "Quality", href: "/quality" }, { label: "New" }]} />
      <NcrForm items={items} lots={lots} members={members} suppliers={suppliers} customers={customers} workOrders={workOrders} today={user.today} canHold={user.permissions.includes("quality.hold")} defaultLotId={sp.lot} />
    </>
  );
}
