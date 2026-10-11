import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DetailGrid, Section, SimpleTable } from "@/components/detail";
import { HistoryList } from "@/components/history";
import { StatusBadge } from "@/components/status-badge";
import { ActionButton, ReasonActionButton } from "@/components/action-button";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { orNotFound } from "@/server/page-helpers";
import { getSalesOrder } from "@/server/queries/sales";
import { formatCurrency, formatDate, formatNumber, formatPercent, toNum } from "@/lib/format";
import { cancelSalesOrderAction, closeSalesOrderAction, confirmSalesOrderAction, createInvoiceAction, releaseReservationsAction, reserveSalesOrderAction } from "../../actions";
import { ShipDialog } from "./ship-dialog";

export const metadata: Metadata = { title: "Sales order" };

export default async function SalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("sales.view");
  const db = await getDb();
  const { so, lines, shipments, invoices, history, total, shippedValue, margin } = await orNotFound(() => getSalesOrder(db, user.ctx, id, user.today));
  const can = (p: string) => user.permissions.includes(p as never);
  const open = ["confirmed", "partially_shipped", "on_hold"].includes(so.status);
  const late = open && so.promised_date < user.today;
  const shippable = lines.filter((l) => l.open > 0);
  const uninvoiced = lines.some((l) => l.shipped > l.invoiced);
  const reservedAny = lines.some((l) => l.reserved > 0);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Sales orders", href: "/sales/orders" }, { label: so.so_number }]}
        title={
          <>
            {so.so_number} <StatusBadge status={so.status} late={late} />
          </>
        }
        description={`${so.customer}${so.customer_po ? ` · PO ${so.customer_po}` : ""} · ships from ${so.wh} (${so.site})`}
        actions={
          <>
            {so.status === "draft" && can("sales.manage") && <ActionButton action={() => confirmSalesOrderAction(so.id)}>Confirm order</ActionButton>}
            {["confirmed", "partially_shipped"].includes(so.status) && can("sales.ship") && (
              <>
                <ActionButton variant="outline" action={() => reserveSalesOrderAction(so.id)}>
                  Reserve stock
                </ActionButton>
                {reservedAny && (
                  <ActionButton variant="ghost" action={() => releaseReservationsAction(so.id)}>
                    Release reservations
                  </ActionButton>
                )}
                {shippable.length > 0 && <ShipDialog soId={so.id} soNumber={so.so_number} lines={shippable} canInvoice={can("finance.manage")} />}
              </>
            )}
            {uninvoiced && can("finance.manage") && (
              <ActionButton variant="outline" action={() => createInvoiceAction(so.id)}>
                Invoice shipped qty
              </ActionButton>
            )}
            {so.status === "partially_shipped" && can("sales.manage") && (
              <ReasonActionButton title={`Close ${so.so_number}`} description="Closes the unshipped remainder and releases its reservations." action={(r) => closeSalesOrderAction(so.id, r)}>
                Close remainder
              </ReasonActionButton>
            )}
            {["draft", "confirmed", "on_hold"].includes(so.status) && can("sales.manage") && (
              <ReasonActionButton title={`Cancel ${so.so_number}`} action={(r) => cancelSalesOrderAction(so.id, r)} confirmLabel="Cancel order" destructive>
                Cancel
              </ReasonActionButton>
            )}
          </>
        }
      />
      <div className="space-y-4">
        <div className="rounded-xl border bg-card p-4">
          <DetailGrid
            items={[
              { label: "Customer", value: <Link href={`/sales/customers?q=${encodeURIComponent(so.customer)}`} className="hover:underline">{so.customer}</Link> },
              { label: "Order date", value: formatDate(so.order_date) },
              { label: "Promised", value: <span className={late ? "text-destructive" : ""}>{formatDate(so.promised_date)}</span> },
              { label: "Order value", value: formatCurrency(total, { cents: true }) },
              { label: "Shipped value", value: `${formatCurrency(shippedValue, { cents: true })} (${formatPercent(total ? (shippedValue / total) * 100 : 0, 0)})` },
              { label: "Std margin", value: `${formatCurrency(margin)} (${formatPercent(total ? (margin / total) * 100 : 0)})` },
            ]}
          />
          {so.notes && <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">{so.notes}</p>}
        </div>
        <Section title="Lines" description="Available = usable stock at the ship-from warehouse not committed to other orders, plus this line's reservation. Estimate only (no capacity check).">
          <SimpleTable
            head={["#", "Product", "Ordered", "Reserved", "Shipped", "Invoiced", "Open", "Available", "Price", "Promised"]}
            align={["left", "left", "right", "right", "right", "right", "right", "right", "right", "left"]}
            rows={lines.map((l) => [
              l.line_no,
              <div key="p">
                <Link href={`/inventory/items/${l.item_id}`} className="font-medium hover:underline">{l.sku}</Link>
                <div className="text-xs text-muted-foreground">{l.name}</div>
              </div>,
              formatNumber(l.ordered),
              formatNumber(l.reserved),
              formatNumber(l.shipped),
              formatNumber(l.invoiced),
              <span key="o" className={l.open > 0 ? "font-medium" : "text-muted-foreground"}>{formatNumber(l.open)}</span>,
              <span key="a" className={l.open > 0 && l.availableForLine < l.open ? "font-medium text-amber-700 dark:text-amber-300" : ""}>{formatNumber(l.availableForLine)}</span>,
              formatCurrency(l.unitPrice, { cents: true }),
              formatDate(l.promised_date, { year: false }),
            ])}
          />
        </Section>
        <div className="grid gap-4 xl:grid-cols-2">
          <Section title={`Shipments (${shipments.length})`}>
            <SimpleTable
              head={["Shipment", "Date", "Contents", "Carrier", "Value"]}
              align={["left", "left", "left", "left", "right"]}
              empty="Nothing shipped yet."
              rows={shipments.map((s) => [
                s.shipment_number,
                formatDate(s.ship_date),
                <div key="c" className="text-xs">
                  {s.lines.map((l, i) => (
                    <div key={i}>
                      {formatNumber(l.quantity)} × {l.sku}
                      {l.lot_number && (
                        <>
                          {" · lot "}
                          <Link href={`/inventory/lots?lot=${encodeURIComponent(l.lot_number)}`} className="hover:underline">{l.lot_number}</Link>
                        </>
                      )}
                    </div>
                  ))}
                </div>,
                <span key="t" className="text-xs text-muted-foreground">{[s.carrier, s.tracking_number].filter(Boolean).join(" · ") || "—"}</span>,
                formatCurrency(s.value, { cents: true }),
              ])}
            />
          </Section>
          <Section title={`Invoices (${invoices.length})`}>
            <SimpleTable
              head={["Invoice", "Status", "Date", "Due", "Total", "Paid"]}
              align={["left", "left", "left", "left", "right", "right"]}
              empty="No invoices yet."
              rows={invoices.map((i) => [
                <Link key="i" href={`/finance?tab=invoices&q=${i.invoice_number}`} className="hover:underline">{i.invoice_number}</Link>,
                <StatusBadge key="s" status={i.status} />,
                formatDate(i.invoice_date),
                formatDate(i.due_date),
                formatCurrency(i.total, { cents: true }),
                formatCurrency(toNum(i.amount_paid), { cents: true }),
              ])}
            />
          </Section>
        </div>
        <Section title="Order history">
          <HistoryList items={history} timeZone={user.org.timezone} />
        </Section>
      </div>
    </>
  );
}
