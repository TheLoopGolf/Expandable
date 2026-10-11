import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { listCustomers } from "@/server/queries/sales";
import { startOfYear } from "@/lib/dates";
import { CustomerDialog } from "./customer-dialog";
import { CustomerTable } from "./customer-table";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const user = await requirePermission("sales.view");
  const db = await getDb();
  const rows = await listCustomers(db, user.ctx, startOfYear(user.today));
  const segments = [...new Set(rows.map((r) => r.segment).filter((s): s is string => !!s))].sort();
  return (
    <>
      <PageHeader
        title="Customers"
        description="Customer master with open order exposure, receivables and year-to-date shipped revenue."
        breadcrumbs={[{ label: "Commercial" }, { label: "Customers" }]}
        actions={user.permissions.includes("sales.manage") ? <CustomerDialog /> : null}
      />
      <CustomerTable rows={rows} segments={segments} />
    </>
  );
}
