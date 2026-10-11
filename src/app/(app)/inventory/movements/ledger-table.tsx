"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";

export interface MovementRow {
  id: string;
  seq: number;
  movement_type: string;
  sku: string;
  item_id: string;
  quantity: number;
  unit_cost: number;
  extended_cost: number;
  wh: string;
  bin: string | null;
  lot_number: string | null;
  reference_type: string | null;
  reference_id: string | null;
  reference_number: string | null;
  reason: string | null;
  occurred_at: string;
  actor: string | null;
}

const REF: Record<string, (id: string) => string> = {
  purchase_order: (id) => `/purchasing/orders/${id}`,
  work_order: (id) => `/production/work-orders/${id}`,
  sales_order: (id) => `/sales/orders/${id}`,
};

export function LedgerTable({ rows, timeZone }: { rows: MovementRow[]; timeZone: string }) {
  const columns: ColumnDef<MovementRow, unknown>[] = [
    { accessorKey: "seq", header: "#", cell: ({ getValue }) => <span className="font-mono text-xs text-muted-foreground">{getValue() as number}</span> },
    { accessorKey: "occurred_at", header: "When", cell: ({ getValue }) => <span className="whitespace-nowrap">{formatDateTime(getValue() as string, timeZone)}</span> },
    { id: "movement_type", accessorFn: (r) => r.movement_type, header: "Type", cell: ({ getValue }) => <span className="capitalize">{(getValue() as string).replace(/_/g, " ")}</span> },
    { accessorKey: "sku", header: "Item", cell: ({ row }) => <Link href={`/inventory/items/${row.original.item_id}`} className="hover:underline">{row.original.sku}</Link> },
    {
      accessorKey: "quantity",
      header: "Qty",
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return <span className={v > 0 ? "text-success" : ""}>{v > 0 ? "+" : ""}{formatNumber(v)}</span>;
      },
      meta: { align: "right" },
    },
    { accessorKey: "extended_cost", header: "Value", cell: ({ getValue }) => formatCurrency(getValue() as number, { cents: true }), meta: { align: "right" } },
    { id: "wh", accessorFn: (r) => r.wh, header: "Warehouse" },
    { accessorKey: "bin", header: "Bin", cell: ({ getValue }) => (getValue() as string) ?? "—" },
    { accessorKey: "lot_number", header: "Lot", cell: ({ getValue }) => (getValue() ? <Link href={`/inventory/lots?lot=${encodeURIComponent(getValue() as string)}`} className="font-mono text-xs hover:underline">{getValue() as string}</Link> : "—") },
    {
      accessorKey: "reference_number",
      header: "Reference",
      cell: ({ row }) => {
        const r = row.original;
        const href = r.reference_id && r.reference_type ? REF[r.reference_type]?.(r.reference_id) : null;
        return href ? <Link href={href} className="hover:underline">{r.reference_number}</Link> : <span className="text-muted-foreground">{r.reference_number ?? "—"}</span>;
      },
    },
    { accessorKey: "reason", header: "Reason", cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{(getValue() as string) ?? ""}</span> },
    { accessorKey: "actor", header: "By", cell: ({ getValue }) => <span className="text-muted-foreground">{(getValue() as string) ?? "—"}</span> },
  ];
  const types = [...new Set(rows.map((r) => r.movement_type))].sort();
  const whs = [...new Set(rows.map((r) => r.wh))].sort();
  return (
    <DataTable
      columns={columns}
      data={rows}
      csvName="inventory-ledger"
      searchPlaceholder="Search SKU, lot, reference…"
      dense
      pageSize={50}
      filters={[
        { id: "movement_type", label: "Type", options: types.map((t) => ({ value: t, label: t.replace(/_/g, " ") })) },
        { id: "wh", label: "Warehouse", options: whs.map((w) => ({ value: w, label: w })) },
      ]}
    />
  );
}
