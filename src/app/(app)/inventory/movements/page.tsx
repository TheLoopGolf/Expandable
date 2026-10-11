import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { listMovements } from "@/server/queries/inventory";
import { formatDate } from "@/lib/format";
import { LedgerTable } from "./ledger-table";

export const metadata: Metadata = { title: "Inventory ledger" };

export default async function MovementsPage() {
  const user = await requirePermission("inventory.view");
  const db = await getDb();
  const rows = await listMovements(db, user.ctx, user.siteId, user.range.from, user.range.to);
  return (
    <>
      <PageHeader
        title="Inventory ledger"
        description={`Immutable movement history for ${user.range.label.toLowerCase()} (${formatDate(user.range.from)} – ${formatDate(user.range.to)}), newest first. Change the period in the top bar.`}
        breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Ledger" }]}
      />
      <LedgerTable
        timeZone={user.org.timezone}
        rows={rows.map((r) => ({ ...r, quantity: Number(r.quantity), unit_cost: Number(r.unit_cost), extended_cost: Number(r.extended_cost), occurred_at: new Date(r.occurred_at).toISOString() }))}
      />
    </>
  );
}
