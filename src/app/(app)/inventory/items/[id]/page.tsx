import type { Metadata } from "next";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DetailGrid, Section, SimpleTable, StatCard } from "@/components/detail";
import { HistoryList } from "@/components/history";
import { StatusBadge, ToneBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { orNotFound } from "@/server/page-helpers";
import { getItem } from "@/server/queries/inventory";
import { binOptions, warehouseOptions } from "@/server/queries/lookups";
import { formatCurrency, formatDate, formatDateTime, formatNumber, toNum } from "@/lib/format";
import { StockTransactionDialog } from "../../stock-dialog";

export const metadata: Metadata = { title: "Item" };

const REF_HREF: Record<string, (id: string) => string> = {
  purchase_order: (id) => `/purchasing/orders/${id}`,
  work_order: (id) => `/production/work-orders/${id}`,
  sales_order: (id) => `/sales/orders/${id}`,
};

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("inventory.view");
  const db = await getDb();
  const data = await orNotFound(() => getItem(db, user.ctx, id, user.today));
  const { item, balances, movements, supply, demand, whereUsed, bom, revisions, history } = data;
  const [warehouses, bins] = await Promise.all([warehouseOptions(db, user.ctx), binOptions(db, user.ctx)]);
  const can = (p: string) => user.permissions.includes(p as never);
  const onHand = balances.reduce((s, b) => s + b.qty, 0);
  const held = balances.filter((b) => b.blocked).reduce((s, b) => s + b.qty, 0);
  const committed = demand.reduce((s, d) => s + d.reserved, 0);
  const totalDemand = demand.reduce((s, d) => s + d.qty, 0);
  const totalSupply = supply.reduce((s, d) => s + d.qty, 0);
  const projected = onHand - held - totalDemand + totalSupply;
  const str = (k: string) => (item[k] === null || item[k] === undefined ? "—" : String(item[k]));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: item.sku }]}
        title={
          <>
            <span className="font-mono">{item.sku}</span>
            <StatusBadge status={str("lifecycle_status")} />
            {item.tracking !== "none" && <ToneBadge tone="neutral" dot={false}>Lot-tracked</ToneBadge>}
          </>
        }
        description={item.name}
        actions={
          <>
            {bom && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/engineering/boms/${bom.id}`}>BOM rev {bom.revision}</Link>
              </Button>
            )}
            {can("inventory.transact") && (
              <StockTransactionDialog
                items={[{ id: item.id, sku: item.sku, name: item.name, tracking: item.tracking, uom: str("uom") }]}
                warehouses={warehouses}
                bins={bins}
                balances={balances.map((b) => ({ item_id: item.id, warehouse_id: b.warehouse_id, bin_id: b.bin_id, lot_id: b.lot_id, lot_number: b.lot_number, lot_status: b.lot_status, qty: b.qty }))}
                defaultItemId={item.id}
              />
            )}
            {can("items.manage") && (
              <Button asChild size="sm">
                <Link href={`/inventory/items/${item.id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="On hand" value={formatNumber(onHand)} sub={`${formatNumber(held)} held/blocked`} />
          <StatCard label="Open demand" value={formatNumber(totalDemand)} sub={`${formatNumber(committed)} reserved/allocated`} />
          <StatCard label="Scheduled supply" value={formatNumber(totalSupply)} sub={`${supply.length} open orders`} />
          <StatCard label="Projected" value={formatNumber(projected)} tone={projected < 0 ? "danger" : undefined} sub="Usable − demand + supply" />
          <StatCard label="Inventory value" value={formatCurrency(onHand * toNum(item.standard_cost))} sub={`Std ${formatCurrency(item.standard_cost, { cents: true })}/${str("uom")}`} />
        </div>
        <div className="rounded-xl border bg-card p-4">
          <DetailGrid
            items={[
              { label: "Type", value: <span className="capitalize">{item.item_type}</span> },
              { label: "Category", value: str("category") },
              { label: "Family", value: str("product_family") },
              { label: "Revision", value: str("revision") },
              { label: "Unit", value: str("uom") },
              { label: "List price", value: item.list_price ? formatCurrency(item.list_price as string, { cents: true }) : "—" },
              { label: "Preferred supplier", value: item.supplier_name ?? "—" },
              { label: "Lead time", value: `${str("lead_time_days")} days` },
              { label: "Reorder point", value: formatNumber(item.reorder_point as string) },
              { label: "Safety stock", value: formatNumber(item.safety_stock as string) },
              { label: "Min order qty", value: formatNumber(item.min_order_qty as string) },
              { label: "Shelf life", value: item.shelf_life_days ? `${str("shelf_life_days")} days` : "—" },
            ]}
          />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Section title="Stock by location">
            <SimpleTable
              head={["Warehouse", "Bin", "Lot", "Expires", "Qty", "Status"]}
              align={["left", "left", "left", "left", "right", "left"]}
              empty="No stock on hand."
              rows={balances.map((b) => [
                b.wh,
                b.bin ?? "—",
                b.lot_number ? <Link key="l" href={`/inventory/lots?lot=${encodeURIComponent(b.lot_number)}`} className="hover:underline">{b.lot_number}</Link> : "—",
                b.expires_on ? <span key="e" className={b.expires_on < user.today ? "text-destructive" : ""}>{formatDate(b.expires_on)}</span> : "—",
                formatNumber(b.qty),
                b.lot_status && b.lot_status !== "available" ? <StatusBadge key="s" status={b.lot_status} /> : b.expires_on && b.expires_on < user.today ? <StatusBadge key="x" status="expired" /> : <StatusBadge key="a" status="available" />,
              ])}
            />
          </Section>
          <Section title="Open supply and demand" description="Time-ordered; reserved = soft allocation to the demand line.">
            <SimpleTable
              head={["", "Order", "Date", "Qty", "Reserved", "Status"]}
              align={["left", "left", "left", "right", "right", "left"]}
              empty="No open supply or demand."
              rows={[
                ...supply.map((s) => [
                  <ToneBadge key="t" tone="success" dot={false}>Supply</ToneBadge>,
                  <Link key="r" href={s.kind === "PO" ? `/purchasing/orders/${s.id}` : `/production/work-orders/${s.id}`} className="hover:underline">{s.ref}</Link>,
                  formatDate(s.date, { year: false }),
                  `+${formatNumber(s.qty)}`,
                  "—",
                  <StatusBadge key="s" status={s.status} />,
                ]),
                ...demand.map((d) => [
                  <ToneBadge key="t" tone="neutral" dot={false}>Demand</ToneBadge>,
                  <Link key="r" href={d.kind === "SO" ? `/sales/orders/${d.id}` : `/production/work-orders/${d.id}`} className="hover:underline">{d.ref}</Link>,
                  formatDate(d.date, { year: false }),
                  `−${formatNumber(d.qty)}`,
                  formatNumber(d.reserved),
                  <StatusBadge key="s" status={d.status} />,
                ]),
              ]}
            />
          </Section>
        </div>
        <Section title="Movement ledger (latest 100)" description="Immutable; corrections are new movements." actions={<Link href={`/inventory/movements?q=${encodeURIComponent(item.sku)}`} className="text-xs text-primary hover:underline">Full ledger</Link>}>
          <SimpleTable
            head={["When", "Type", "Qty", "Warehouse", "Lot", "Reference", "Actor"]}
            align={["left", "left", "right", "left", "left", "left", "left"]}
            empty="No movements yet."
            rows={movements.map((m) => [
              <span key="w" className="whitespace-nowrap text-muted-foreground">{formatDateTime(m.occurred_at, user.org.timezone)}</span>,
              <span key="t" className="capitalize">{m.movement_type.replace(/_/g, " ")}</span>,
              <span key="q" className={toNum(m.quantity) > 0 ? "text-success" : ""}>{toNum(m.quantity) > 0 ? "+" : ""}{formatNumber(m.quantity)}</span>,
              m.wh,
              m.lot_number ?? "—",
              m.reference_id && m.reference_type && REF_HREF[m.reference_type] ? (
                <Link key="r" href={REF_HREF[m.reference_type](m.reference_id)} className="hover:underline">{m.reference_number}</Link>
              ) : (
                <span key="r" className="text-muted-foreground">{m.reference_number ?? "—"}{m.reason ? ` · ${m.reason}` : ""}</span>
              ),
              <span key="a" className="text-muted-foreground">{m.actor ?? "—"}</span>,
            ])}
          />
        </Section>
        <div className="grid gap-4 xl:grid-cols-3">
          <Section title="Where used">
            <SimpleTable
              head={["Assembly", "Level"]}
              empty="Not used in any released BOM."
              rows={whereUsed.map((w) => [<Link key="a" href={`/inventory/items/${w.assemblyId}`} className="hover:underline">{w.sku} — {w.name}</Link>, w.level === 1 ? "Direct" : `Level ${w.level}`])}
            />
          </Section>
          <Section title="Revisions">
            <SimpleTable head={["Rev", "Status", "Effective", "Notes"]} rows={revisions.map((r) => [r.revision, <StatusBadge key="s" status={r.status} />, formatDate(r.effective_from), <span key="n" className="text-xs text-muted-foreground">{r.notes}</span>])} />
          </Section>
          <Section title="Item history">
            <HistoryList items={history} timeZone={user.org.timezone} />
          </Section>
        </div>
      </div>
    </>
  );
}
