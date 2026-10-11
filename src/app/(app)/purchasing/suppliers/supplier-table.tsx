"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

export interface SupplierRow {
  id: string;
  code: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  payment_terms_days: number;
  default_lead_time_days: number;
  rating: string | null;
  openValue: number;
  onTimePct: number | null;
  avgLead: number | null;
  items: number;
  receipts: number;
}

const columns: ColumnDef<SupplierRow, unknown>[] = [
  { accessorKey: "code", header: "Code", cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() as string}</span> },
  {
    accessorKey: "name",
    header: "Supplier",
    cell: ({ row }) => (
      <div>
        <Link href={`/purchasing?supplier=${encodeURIComponent(row.original.name)}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
        <div className="text-xs text-muted-foreground">{row.original.contact_name ?? row.original.email ?? ""}</div>
      </div>
    ),
  },
  { accessorKey: "items", header: "Items supplied", meta: { align: "right" } },
  { accessorKey: "openValue", header: "Open PO value", cell: ({ getValue }) => formatCurrency(getValue() as number), meta: { align: "right" } },
  { accessorKey: "receipts", header: "Receipts", meta: { align: "right" } },
  {
    accessorKey: "onTimePct",
    header: "On-time receipt",
    cell: ({ getValue }) => {
      const v = getValue() as number | null;
      return <span className={v !== null && v < 80 ? "font-medium text-destructive" : ""}>{formatPercent(v)}</span>;
    },
    meta: { align: "right" },
  },
  { accessorKey: "avgLead", header: "Avg actual lead (d)", cell: ({ getValue }) => (getValue() === null ? "—" : formatNumber(getValue() as number, 1)), meta: { align: "right" } },
  { accessorKey: "default_lead_time_days", header: "Quoted lead (d)", meta: { align: "right" } },
  { accessorKey: "payment_terms_days", header: "Terms (d)", meta: { align: "right" } },
  { accessorKey: "rating", header: "Rating", meta: { align: "right" } },
];

export function SupplierTable({ rows }: { rows: SupplierRow[] }) {
  return <DataTable columns={columns} data={rows} csvName="suppliers" searchPlaceholder="Search suppliers…" initialSort={[{ id: "name", desc: false }]} />;
}
