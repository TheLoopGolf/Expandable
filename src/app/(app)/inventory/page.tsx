import type { Metadata } from "next";
import Link from "next/link";
import { History, Layers, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/detail";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { listItems } from "@/server/queries/inventory";
import { binOptions, warehouseOptions } from "@/server/queries/lookups";
import { formatCurrency } from "@/lib/format";
import { ItemTable } from "./item-table";
import { StockTransactionDialog } from "./stock-dialog";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const user = await requirePermission("inventory.view");
  const db = await getDb();
  const [items, warehouses, bins, balances] = await Promise.all([
    listItems(db, user.ctx, user.siteId, user.today),
    warehouseOptions(db, user.ctx),
    binOptions(db, user.ctx),
    db.query<{ item_id: string; warehouse_id: string; bin_id: string | null; lot_id: string | null; lot_number: string | null; lot_status: string | null; qty: string }>(
      `select b.item_id, b.warehouse_id, b.bin_id, b.lot_id, l.lot_number, l.status as lot_status, b.qty_on_hand as qty
       from inventory_balances b left join inventory_lots l on l.id = b.lot_id where b.organization_id = $1 and b.qty_on_hand > 0`,
      [user.ctx.orgId],
    ),
  ]);
  const categories = [...new Set(items.map((i) => i.category))].sort();
  const families = [...new Set(items.map((i) => i.family).filter(Boolean))].sort();
  const can = (p: string) => user.permissions.includes(p as never);
  const scopedWh = user.siteId ? warehouses.filter((w) => w.site_id === user.siteId) : warehouses;
  return (
    <>
      <PageHeader
        title="Inventory"
        description="Part master with multi-location stock. Available = on hand − held − reserved (sales) − allocated (work orders)."
        breadcrumbs={[{ label: "Operations" }, { label: "Inventory" }]}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/inventory/lots">
                <Layers /> Lots
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/inventory/movements">
                <History /> Ledger
              </Link>
            </Button>
            {can("inventory.transact") && (
              <StockTransactionDialog
                items={items.map((i) => ({ id: i.id, sku: i.sku, name: i.name, tracking: i.tracking, uom: i.uom }))}
                warehouses={scopedWh}
                bins={bins}
                balances={balances.map((b) => ({ ...b, qty: Number(b.qty) }))}
              />
            )}
            {can("items.manage") && (
              <Button asChild size="sm">
                <Link href="/inventory/items/new">
                  <Plus /> New item
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Inventory value" value={formatCurrency(items.reduce((s, i) => s + i.value, 0))} sub={`${items.length} items at standard cost`} />
        <StatCard label="Shortages" value={items.filter((i) => i.flags.includes("shortage") || i.flags.includes("critical")).length} tone="danger" sub={`${items.filter((i) => i.flags.includes("critical")).length} critical`} />
        <StatCard label="Below safety stock" value={items.filter((i) => i.flags.includes("below_safety")).length} />
        <StatCard label="Items with held stock" value={items.filter((i) => i.held > 0).length} sub="Hold, quarantine or expired" />
      </div>
      <ItemTable rows={items} categories={categories} families={families} />
    </>
  );
}
