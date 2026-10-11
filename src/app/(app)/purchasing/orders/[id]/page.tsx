import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DetailGrid, Section, SimpleTable } from "@/components/detail";
import { HistoryList } from "@/components/history";
import { StatusBadge, ToneBadge } from "@/components/status-badge";
import { ActionButton, ReasonActionButton } from "@/components/action-button";
import { Progress } from "@/components/ui/progress";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { orNotFound } from "@/server/page-helpers";
import { getPurchaseOrder } from "@/server/queries/purchasing";
import { formatCurrency, formatDate, formatDateTime, formatNumber, toNum } from "@/lib/format";
import { approvePurchaseOrderAction, cancelPurchaseOrderAction, closePurchaseOrderAction, createSupplierBillAction } from "../../actions";
import { ReceiveDialog } from "./receive-dialog";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("purchasing.view");
  const db = await getDb();
  const { po, lines, receipts, bills, bins, history, total, receivedValue } = await orNotFound(() => getPurchaseOrder(db, user.ctx, id));
  const can = (p: string) => user.permissions.includes(p as never);
  const late = ["approved", "partially_received"].includes(po.status) && po.expected_date < user.today;
  const receivable = lines
    .map((l) => ({ ...l, outstanding: toNum(l.quantity_ordered) - toNum(l.quantity_received) }))
    .filter((l) => l.outstanding > 0);
  const billed = bills.filter((b) => b.status !== "void").reduce((s, b) => s + toNum(b.total), 0);
  const receivedCost = receipts.length ? receivedValue : 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Purchasing", href: "/purchasing" }, { label: po.po_number }]}
        title={
          <>
            {po.po_number}
            <StatusBadge status={po.status} late={late} />
            {po.source === "mrp" && <ToneBadge tone="info" dot={false}>From MRP</ToneBadge>}
          </>
        }
        description={`${po.supplier} · ship to ${po.wh} (${po.site})`}
        actions={
          <>
            {po.status === "draft" && can("purchasing.approve") && (
              <ActionButton action={approvePurchaseOrderAction.bind(null, po.id)} confirm={{ title: `Approve ${po.po_number}?`, description: `Commits ${formatCurrency(total, { cents: true })} with ${po.supplier}. Approved orders can be received.`, confirmLabel: "Approve" }}>
                Approve
              </ActionButton>
            )}
            {["approved", "partially_received"].includes(po.status) && can("purchasing.receive") && receivable.length > 0 && (
              <ReceiveDialog poId={po.id} poNumber={po.po_number} lines={receivable} bins={bins} />
            )}
            {po.status === "partially_received" && can("purchasing.approve") && (
              <ReasonActionButton title={`Short-close ${po.po_number}`} description="The remaining open quantity will no longer be expected." action={closePurchaseOrderAction.bind(null, po.id)}>
                Short-close
              </ReasonActionButton>
            )}
            {["draft", "approved"].includes(po.status) && can("purchasing.approve") && (
              <ReasonActionButton title={`Cancel ${po.po_number}`} action={cancelPurchaseOrderAction.bind(null, po.id)} confirmLabel="Cancel order" destructive>
                Cancel
              </ReasonActionButton>
            )}
            {can("finance.manage") && receivedCost - billed > 0.01 && (
              <ActionButton variant="outline" action={createSupplierBillAction.bind(null, po.id)} confirm={{ title: "Record supplier bill", description: `Creates an AP bill for ${formatCurrency(receivedCost - billed, { cents: true })} of received, unbilled value.` }}>
                Record bill
              </ActionButton>
            )}
          </>
        }
      />
      <div className="space-y-4">
        <div className="rounded-xl border bg-card p-4">
          <DetailGrid
            items={[
              { label: "Supplier", value: <Link href={`/purchasing/suppliers?supplier=${po.supplier_id}`} className="hover:underline">{po.supplier}</Link> },
              { label: "Order date", value: formatDate(po.order_date) },
              { label: "Expected", value: <span className={late ? "text-destructive" : ""}>{formatDate(po.expected_date)}</span> },
              { label: "Order value", value: formatCurrency(total, { cents: true }) },
              { label: "Received value", value: formatCurrency(receivedValue, { cents: true }) },
              { label: "Approved by", value: po.approved_by ? `${po.approved_by}, ${formatDateTime(po.approved_at, user.org.timezone)}` : "—" },
            ]}
          />
          {po.notes && <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">{po.notes}</p>}
        </div>
        <Section title="Lines">
          <SimpleTable
            head={["#", "Item", "Ordered", "Received", "Outstanding", "Unit cost", "Std cost", "Expected", "Progress"]}
            align={["left", "left", "right", "right", "right", "right", "right", "left", "left"]}
            rows={lines.map((l) => {
              const ordered = toNum(l.quantity_ordered);
              const received = toNum(l.quantity_received);
              return [
                l.line_no,
                <div key="i">
                  <Link href={`/inventory/items/${l.item_id}`} className="font-medium hover:underline">{l.sku}</Link>
                  <div className="text-xs text-muted-foreground">{l.name}</div>
                </div>,
                `${formatNumber(ordered)} ${l.uom}`,
                formatNumber(received),
                <span key="o" className={ordered - received > 0 ? "font-medium" : "text-muted-foreground"}>{formatNumber(ordered - received)}</span>,
                formatCurrency(l.unit_cost, { cents: true }),
                <span key="s" className="text-muted-foreground">{formatCurrency(l.standard_cost, { cents: true })}</span>,
                formatDate(l.expected_date, { year: false }),
                <Progress key="p" value={ordered ? (received / ordered) * 100 : 0} className="h-1.5 w-24" aria-label={`Line ${l.line_no} received`} />,
              ];
            })}
          />
        </Section>
        <div className="grid gap-4 xl:grid-cols-2">
          <Section title={`Receipts (${receipts.length})`}>
            <SimpleTable
              head={["Receipt", "Item", "Qty", "Lot", "Bin", "Received"]}
              align={["left", "left", "right", "left", "left", "left"]}
              empty="Nothing received yet."
              rows={receipts.map((r) => [
                r.receipt_number,
                r.sku,
                formatNumber(r.quantity),
                r.lot_number ? (
                  <span key="l" className="inline-flex items-center gap-1.5">
                    <Link href={`/inventory/lots?lot=${encodeURIComponent(r.lot_number)}`} className="hover:underline">{r.lot_number}</Link>
                    {r.lot_status && r.lot_status !== "available" && <StatusBadge status={r.lot_status} />}
                  </span>
                ) : "—",
                r.bin ?? "—",
                <span key="t" className="text-muted-foreground">{r.received_by} · {formatDateTime(r.received_at, user.org.timezone)}</span>,
              ])}
            />
          </Section>
          <Section title="History">
            <HistoryList items={history} timeZone={user.org.timezone} />
          </Section>
        </div>
        {bills.length > 0 && (
          <Section title="Supplier bills">
            <SimpleTable
              head={["Bill", "Status", "Date", "Due", "Total"]}
              align={["left", "left", "left", "left", "right"]}
              rows={bills.map((b) => [b.bill_number, <StatusBadge key="s" status={b.status} />, formatDate(b.bill_date), formatDate(b.due_date), formatCurrency(b.total, { cents: true })])}
            />
          </Section>
        )}
      </div>
    </>
  );
}
