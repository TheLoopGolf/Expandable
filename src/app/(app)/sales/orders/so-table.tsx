"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/format";

export interface SoRow {
  id: string;
  so_number: string;
  status: string;
  customer: string;
  order_date: string;
  promised_date: string;
  customer_po: string | null;
  total: number;
  openValue: number;
  shippedPct: number;
  lines: number;
  wh: string;
  late: boolean;
  bucket: string;
  family: string;
}

const columns: ColumnDef<SoRow, unknown>[] = [
  {
    accessorKey: "so_number",
    header: "Order",
    cell: ({ row }) => (
      <Link href={`/sales/orders/${row.original.id}`} className="font-medium text-primary hover:underline">
        {row.original.so_number}
      </Link>
    ),
  },
  { accessorKey: "customer", header: "Customer" },
  { accessorKey: "customer_po", header: "Customer PO", cell: ({ getValue }) => <span className="text-muted-foreground">{(getValue() as string) ?? "—"}</span> },
  { id: "status", accessorFn: (r) => r.status, header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} late={row.original.late} /> },
  { accessorKey: "order_date", header: "Ordered", cell: ({ getValue }) => formatDate(getValue() as string) },
  {
    accessorKey: "promised_date",
    header: "Promised",
    cell: ({ row }) => <span className={row.original.late ? "font-medium text-destructive" : ""}>{formatDate(row.original.promised_date)}</span>,
  },
  { accessorKey: "total", header: "Order value", cell: ({ getValue }) => formatCurrency(getValue() as number, { cents: true }), meta: { align: "right" } },
  { accessorKey: "openValue", header: "Open value", cell: ({ getValue }) => formatCurrency(getValue() as number), meta: { align: "right" } },
  { accessorKey: "shippedPct", header: "Shipped", cell: ({ getValue }) => `${(getValue() as number).toFixed(0)}%`, meta: { align: "right" } },
  { accessorKey: "wh", header: "Ship from" },
  { id: "bucket", accessorFn: (r) => r.bucket, header: "Open/closed" },
  { id: "late", accessorFn: (r) => (r.late ? "late" : "ok"), header: "Late" },
  { id: "family", accessorFn: (r) => r.family, header: "Family", filterFn: "includesString" },
];

export function SalesOrderTable({ rows, customers, families }: { rows: SoRow[]; customers: string[]; families: string[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      csvName="sales-orders"
      searchPlaceholder="Search order, customer, PO…"
      rowHref={(r) => `/sales/orders/${r.id}`}
      hiddenColumns={["bucket", "late", "family"]}
      filters={[
        { id: "bucket", label: "Scope", options: [{ value: "open", label: "Open (confirmed, partial, on hold)" }, { value: "draft", label: "Drafts" }, { value: "done", label: "Shipped / closed / canceled" }] },
        { id: "status", label: "Status", options: ["draft", "confirmed", "partially_shipped", "shipped", "closed", "canceled"].map((s) => ({ value: s, label: s.replace("_", " ") })) },
        { id: "late", label: "Late", options: [{ value: "late", label: "Late only" }] },
        { id: "customer", label: "Customer", options: customers.map((c) => ({ value: c, label: c })) },
        { id: "family", label: "Family", options: families.map((f) => ({ value: f, label: f })) },
      ]}
    />
  );
}
