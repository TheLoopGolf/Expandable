"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { StatusBadge, ToneBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/format";

export interface PoRow {
  id: string;
  po_number: string;
  status: string;
  supplier: string;
  supplier_id: string;
  order_date: string;
  expected_date: string;
  total: number;
  receivedPct: number;
  lines: number;
  wh: string;
  late: boolean;
  source: string;
}

const columns: ColumnDef<PoRow, unknown>[] = [
  {
    accessorKey: "po_number",
    header: "PO",
    cell: ({ row }) => (
      <Link href={`/purchasing/orders/${row.original.id}`} className="font-medium text-primary hover:underline">
        {row.original.po_number}
      </Link>
    ),
  },
  { accessorKey: "supplier", header: "Supplier" },
  {
    id: "status",
    accessorFn: (r) => r.status,
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} late={row.original.late} />,
    meta: { csv: (r) => r.status },
  },
  { accessorKey: "order_date", header: "Ordered", cell: ({ getValue }) => formatDate(getValue() as string) },
  {
    accessorKey: "expected_date",
    header: "Expected",
    cell: ({ row }) => <span className={row.original.late ? "font-medium text-destructive" : ""}>{formatDate(row.original.expected_date)}</span>,
  },
  { accessorKey: "lines", header: "Lines", meta: { align: "right" } },
  { accessorKey: "total", header: "Value", cell: ({ getValue }) => formatCurrency(getValue() as number, { cents: true }), meta: { align: "right" } },
  {
    accessorKey: "receivedPct",
    header: "Received",
    cell: ({ getValue }) => `${(getValue() as number).toFixed(0)}%`,
    meta: { align: "right" },
  },
  { accessorKey: "wh", header: "Ship to" },
  {
    id: "source",
    accessorFn: (r) => r.source,
    header: "Source",
    cell: ({ row }) => (row.original.source === "mrp" ? <ToneBadge tone="info" dot={false}>MRP</ToneBadge> : <span className="text-muted-foreground">Manual</span>),
  },
  { id: "late", accessorFn: (r) => (r.late ? "late" : "on_time"), header: "Late", enableSorting: false },
];

export function PurchaseOrderTable({ rows, suppliers }: { rows: PoRow[]; suppliers: { id: string; name: string }[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      csvName="purchase-orders"
      searchPlaceholder="Search PO, supplier…"
      rowHref={(r) => `/purchasing/orders/${r.id}`}
      hiddenColumns={["late"]}
      filters={[
        {
          id: "status",
          label: "Status",
          options: ["draft", "approved", "partially_received", "received", "closed", "canceled"].map((s) => ({ value: s, label: s.replace("_", " ") })),
        },
        { id: "late", label: "Late", options: [{ value: "late", label: "Late only" }] },
        { id: "supplier", label: "Supplier", options: suppliers.map((s) => ({ value: s.name, label: s.name })) },
      ]}
    />
  );
}
