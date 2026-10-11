"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { StatusBadge, ToneBadge } from "@/components/status-badge";
import { formatCurrency, formatNumber } from "@/lib/format";

export interface ItemRow {
  id: string;
  sku: string;
  name: string;
  type: string;
  category: string;
  family: string;
  uom: string;
  revision: string;
  lifecycle: string;
  tracking: string;
  cost: number;
  supplier: string;
  leadTime: number;
  reorderPoint: number;
  safetyStock: number;
  onHand: number;
  held: number;
  reserved: number;
  allocated: number;
  available: number;
  incoming: number;
  value: number;
  flags: string[];
  alert: string;
}

const FLAG_LABEL: Record<string, [string, "danger" | "warning" | "neutral"]> = {
  critical: ["Critical shortage", "danger"],
  shortage: ["Shortage", "danger"],
  below_safety: ["Below safety", "warning"],
  held: ["Held stock", "warning"],
};

const n = (v: number) => formatNumber(v);

const columns: ColumnDef<ItemRow, unknown>[] = [
  {
    accessorKey: "sku",
    header: "SKU",
    cell: ({ row }) => (
      <Link href={`/inventory/items/${row.original.id}`} className="font-medium whitespace-nowrap text-primary hover:underline">
        {row.original.sku}
      </Link>
    ),
  },
  {
    accessorKey: "name",
    header: "Description",
    cell: ({ row }) => (
      <div className="max-w-[260px]">
        <div className="truncate">{row.original.name}</div>
        <div className="text-xs text-muted-foreground">
          {row.original.category} · rev {row.original.revision}
          {row.original.tracking !== "none" ? " · lot-tracked" : ""}
        </div>
      </div>
    ),
  },
  { id: "type", accessorFn: (r) => r.type, header: "Type", cell: ({ getValue }) => <span className="text-muted-foreground capitalize">{getValue() as string}</span> },
  { accessorKey: "onHand", header: "On hand", cell: ({ getValue }) => n(getValue() as number), meta: { align: "right" } },
  { accessorKey: "held", header: "Held", cell: ({ getValue }) => ((getValue() as number) > 0 ? <span className="text-amber-700 dark:text-amber-300">{n(getValue() as number)}</span> : "0"), meta: { align: "right" } },
  { accessorKey: "reserved", header: "Reserved", cell: ({ getValue }) => n(getValue() as number), meta: { align: "right" } },
  { accessorKey: "allocated", header: "Allocated", cell: ({ getValue }) => n(getValue() as number), meta: { align: "right" } },
  {
    accessorKey: "available",
    header: "Available",
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return <span className={v < 0 ? "font-medium text-destructive" : "font-medium"}>{n(v)}</span>;
    },
    meta: { align: "right" },
  },
  { accessorKey: "incoming", header: "Incoming", cell: ({ getValue }) => n(getValue() as number), meta: { align: "right" } },
  { accessorKey: "safetyStock", header: "Safety", cell: ({ getValue }) => n(getValue() as number), meta: { align: "right" } },
  { accessorKey: "cost", header: "Std cost", cell: ({ getValue }) => formatCurrency(getValue() as number, { cents: true }), meta: { align: "right" } },
  { accessorKey: "value", header: "Value", cell: ({ getValue }) => formatCurrency(getValue() as number), meta: { align: "right" } },
  {
    id: "flags",
    accessorFn: (r) => r.flags.join(" "),
    header: "Alerts",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.lifecycle !== "active" && <StatusBadge status={row.original.lifecycle} />}
        {row.original.flags.map((f) => (
          <ToneBadge key={f} tone={FLAG_LABEL[f][1]}>
            {FLAG_LABEL[f][0]}
          </ToneBadge>
        ))}
      </div>
    ),
  },
  { id: "category", accessorFn: (r) => r.category, header: "Category" },
  { id: "family", accessorFn: (r) => r.family, header: "Family" },
  { id: "alert", accessorFn: (r) => (r.alert === "none" ? "none" : r.alert), header: "Alert", filterFn: (row, id, value) => (value === "any" ? row.original.flags.length > 0 : row.getValue(id) === value) },
  { id: "supplier", accessorFn: (r) => r.supplier, header: "Supplier" },
];

export function ItemTable({ rows, categories, families }: { rows: ItemRow[]; categories: string[]; families: string[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      csvName="items"
      searchPlaceholder="Search SKU, description, supplier…"
      rowHref={(r) => `/inventory/items/${r.id}`}
      hiddenColumns={["category", "family", "alert", "supplier"]}
      pageSize={30}
      filters={[
        { id: "type", label: "Type", options: [{ value: "purchased", label: "Purchased" }, { value: "manufactured", label: "Manufactured" }] },
        { id: "category", label: "Category", options: categories.map((c) => ({ value: c, label: c })) },
        { id: "family", label: "Family", options: families.map((f) => ({ value: f, label: f })) },
        {
          id: "alert",
          label: "Alerts",
          options: [
            { value: "any", label: "Any alert" },
            { value: "shortage", label: "Shortage" },
            { value: "below_safety", label: "Below safety stock" },
            { value: "held", label: "Held stock" },
          ],
        },
      ]}
    />
  );
}
