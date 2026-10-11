"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { ActionButton } from "@/components/action-button";
import { formatCurrency, formatDate } from "@/lib/format";
import { issueInvoiceAction, paySupplierBillAction, recordPaymentAction } from "./actions";

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  status: string;
  customer: string;
  so_id: string | null;
  so_number: string | null;
  invoice_date: string;
  due_date: string;
  total: number;
  paid: number;
  open: number;
  daysOverdue: number;
  overdue: boolean;
}

export function InvoiceTable({ rows, canManage }: { rows: InvoiceRow[]; canManage: boolean }) {
  const columns: ColumnDef<InvoiceRow, unknown>[] = [
    { accessorKey: "invoice_number", header: "Invoice", cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { accessorKey: "customer", header: "Customer" },
    { accessorKey: "so_number", header: "Order", cell: ({ row }) => (row.original.so_id ? <Link href={`/sales/orders/${row.original.so_id}`} className="hover:underline">{row.original.so_number}</Link> : "—") },
    { id: "status", accessorFn: (r) => (r.overdue ? "overdue" : r.status), header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} late={row.original.overdue} /> },
    { accessorKey: "invoice_date", header: "Date", cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: "due_date", header: "Due", cell: ({ row }) => <span className={row.original.overdue ? "font-medium text-destructive" : ""}>{formatDate(row.original.due_date)}{row.original.overdue ? ` (${row.original.daysOverdue}d)` : ""}</span> },
    { accessorKey: "total", header: "Total", cell: ({ getValue }) => formatCurrency(getValue() as number, { cents: true }), meta: { align: "right" } },
    { accessorKey: "open", header: "Open", cell: ({ getValue }) => formatCurrency(getValue() as number, { cents: true }), meta: { align: "right" } },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        if (!canManage) return null;
        if (r.status === "draft") return <ActionButton size="xs" variant="outline" action={() => issueInvoiceAction(r.id)}>Issue</ActionButton>;
        if (r.status === "issued")
          return (
            <ActionButton size="xs" variant="outline" action={() => recordPaymentAction(r.id)} confirm={{ title: `Record payment for ${r.invoice_number}`, description: `Records ${formatCurrency(r.open, { cents: true })} received by ACH and posts it to cash.` }}>
              Record payment
            </ActionButton>
          );
        return null;
      },
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      csvName="invoices"
      searchPlaceholder="Search invoice, customer, order…"
      filters={[{ id: "status", label: "Status", options: [{ value: "draft", label: "Draft" }, { value: "issued", label: "Issued (not overdue)" }, { value: "overdue", label: "Overdue" }, { value: "paid", label: "Paid" }] }]}
    />
  );
}

export interface BillRow {
  id: string;
  bill_number: string;
  status: string;
  supplier: string;
  po_id: string | null;
  po_number: string | null;
  bill_date: string;
  due_date: string;
  total: number;
  open: number;
  overdue: boolean;
}

export function BillTable({ rows, canManage }: { rows: BillRow[]; canManage: boolean }) {
  const columns: ColumnDef<BillRow, unknown>[] = [
    { accessorKey: "bill_number", header: "Bill", cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { accessorKey: "supplier", header: "Supplier" },
    { accessorKey: "po_number", header: "PO", cell: ({ row }) => (row.original.po_id ? <Link href={`/purchasing/orders/${row.original.po_id}`} className="hover:underline">{row.original.po_number}</Link> : "—") },
    { id: "status", accessorFn: (r) => r.status, header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} late={row.original.overdue} /> },
    { accessorKey: "bill_date", header: "Date", cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: "due_date", header: "Due", cell: ({ row }) => <span className={row.original.overdue ? "font-medium text-destructive" : ""}>{formatDate(row.original.due_date)}</span> },
    { accessorKey: "total", header: "Total", cell: ({ getValue }) => formatCurrency(getValue() as number, { cents: true }), meta: { align: "right" } },
    { accessorKey: "open", header: "Open", cell: ({ getValue }) => formatCurrency(getValue() as number, { cents: true }), meta: { align: "right" } },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) =>
        canManage && row.original.status === "open" ? (
          <ActionButton size="xs" variant="outline" action={() => paySupplierBillAction(row.original.id)} confirm={{ title: `Pay ${row.original.bill_number}?`, description: `Records a ${formatCurrency(row.original.open, { cents: true })} ACH payment to ${row.original.supplier}.` }}>
            Pay
          </ActionButton>
        ) : null,
    },
  ];
  return <DataTable columns={columns} data={rows} csvName="supplier-bills" searchPlaceholder="Search bill, supplier, PO…" filters={[{ id: "status", label: "Status", options: [{ value: "open", label: "Open" }, { value: "paid", label: "Paid" }] }]} />;
}
