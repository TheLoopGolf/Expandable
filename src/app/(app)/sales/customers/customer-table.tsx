"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { formatCurrency, formatDate } from "@/lib/format";

export interface CustomerRow {
  id: string;
  code: string;
  name: string;
  segment: string | null;
  payment_terms_days: number;
  creditLimit: number | null;
  openOrders: number;
  ar: number;
  ytd: number;
  last_order: string | null;
}

const columns: ColumnDef<CustomerRow, unknown>[] = [
  { accessorKey: "code", header: "Code", cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() as string}</span> },
  {
    accessorKey: "name",
    header: "Customer",
    cell: ({ row }) => (
      <Link href={`/sales/orders?customer=${encodeURIComponent(row.original.name)}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  { id: "segment", accessorFn: (r) => r.segment ?? "", header: "Segment" },
  { accessorKey: "openOrders", header: "Open orders", cell: ({ getValue }) => formatCurrency(getValue() as number), meta: { align: "right" } },
  {
    accessorKey: "ar",
    header: "AR balance",
    cell: ({ row }) => {
      const over = row.original.creditLimit !== null && row.original.ar + row.original.openOrders > row.original.creditLimit;
      return <span className={over ? "font-medium text-destructive" : ""} title={over ? "Open orders + AR exceed credit limit" : undefined}>{formatCurrency(row.original.ar)}</span>;
    },
    meta: { align: "right", csv: (r) => r.ar },
  },
  { accessorKey: "creditLimit", header: "Credit limit", cell: ({ getValue }) => (getValue() === null ? "—" : formatCurrency(getValue() as number)), meta: { align: "right" } },
  { accessorKey: "ytd", header: "Shipped YTD", cell: ({ getValue }) => formatCurrency(getValue() as number), meta: { align: "right" } },
  { accessorKey: "payment_terms_days", header: "Terms (d)", meta: { align: "right" } },
  { accessorKey: "last_order", header: "Last order", cell: ({ getValue }) => formatDate(getValue() as string | null) },
];

export function CustomerTable({ rows, segments }: { rows: CustomerRow[]; segments: string[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      csvName="customers"
      searchPlaceholder="Search customers…"
      initialSort={[{ id: "ytd", desc: true }]}
      filters={[{ id: "segment", label: "Segment", options: segments.map((s) => ({ value: s, label: s })) }]}
    />
  );
}
