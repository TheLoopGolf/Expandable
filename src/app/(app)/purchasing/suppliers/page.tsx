import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { listSuppliers } from "@/server/queries/purchasing";
import { SupplierDialog } from "./supplier-dialog";
import { SupplierTable } from "./supplier-table";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const user = await requirePermission("purchasing.view");
  const db = await getDb();
  const rows = await listSuppliers(db, user.ctx);
  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Supplier master with open commitments and receiving performance (on-time = received on or before the PO line's expected date)."
        breadcrumbs={[{ label: "Commercial" }, { label: "Suppliers" }]}
        actions={user.permissions.includes("purchasing.manage") ? <SupplierDialog /> : null}
      />
      <SupplierTable rows={rows} />
    </>
  );
}
