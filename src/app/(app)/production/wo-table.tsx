"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { TriangleAlert } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { StatusBadge, ToneBadge } from "@/components/status-badge";
import { Progress } from "@/components/ui/progress";
import { formatDate, formatNumber } from "@/lib/format";

export interface WoRow {
  id: string;
  number: string;
  status: string;
  priority: string;
  sku: string;
  name: string;
  family: string;
  planned: number;
  completed: number;
  scrapped: number;
  progress: number;
  plannedStart: string;
  dueDate: string;
  workCenter: string;
  source: string;
  site: string;
  late: boolean;
  blocker: string | null;
  scope: string;
}

const columns: ColumnDef<WoRow, unknown>[] = [
  {
    accessorKey: "number",
    header: "Work order",
    cell: ({ row }) => (
      <Link href={`/production/work-orders/${row.original.id}`} className="font-medium whitespace-nowrap text-primary hover:underline">
        {row.original.number}
      </Link>
    ),
  },
  {
    accessorKey: "sku",
    header: "Product",
    cell: ({ row }) => (
      <div className="max-w-[240px]">
        <div className="font-medium">{row.original.sku}</div>
        <div className="truncate text-xs text-muted-foreground">{row.original.name}</div>
      </div>
    ),
  },
  { id: "status", accessorFn: (r) => r.status, header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} late={row.original.late} /> },
  { id: "priority", accessorFn: (r) => r.priority, header: "Priority", cell: ({ row }) => (row.original.priority === "normal" ? <span className="text-muted-foreground">Normal</span> : <StatusBadge status={row.original.priority} />) },
  { accessorKey: "planned", header: "Planned", cell: ({ getValue }) => formatNumber(getValue() as number), meta: { align: "right" } },
  { accessorKey: "completed", header: "Good", cell: ({ getValue }) => formatNumber(getValue() as number), meta: { align: "right" } },
  { accessorKey: "scrapped", header: "Scrap", cell: ({ getValue }) => formatNumber(getValue() as number), meta: { align: "right" } },
  {
    accessorKey: "progress",
    header: "Progress",
    cell: ({ row }) => (
      <div className="flex w-28 items-center gap-2">
        <Progress value={row.original.progress} className="h-1.5" aria-label={`${row.original.number} progress`} />
        <span className="w-8 text-right text-xs tabular text-muted-foreground">{row.original.progress.toFixed(0)}%</span>
      </div>
    ),
  },
  { accessorKey: "plannedStart", header: "Start", cell: ({ getValue }) => formatDate(getValue() as string, { year: false }) },
  { accessorKey: "dueDate", header: "Due", cell: ({ row }) => <span className={row.original.late ? "font-medium text-destructive" : ""}>{formatDate(row.original.dueDate, { year: false })}</span> },
  { id: "workCenter", accessorFn: (r) => r.workCenter, header: "Line" },
  {
    id: "blocker",
    accessorFn: (r) => r.blocker ?? "",
    header: "Blocker",
    cell: ({ row }) =>
      row.original.blocker ? (
        <span className="inline-flex max-w-[200px] items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span className="line-clamp-2">{row.original.blocker}</span>
        </span>
      ) : null,
  },
  { id: "source", accessorFn: (r) => r.source, header: "Source", cell: ({ row }) => (row.original.source === "mrp" ? <ToneBadge tone="info" dot={false}>MRP</ToneBadge> : null) },
  { id: "scope", accessorFn: (r) => r.scope, header: "Scope" },
  { id: "late", accessorFn: (r) => (r.late ? "late" : "ok"), header: "Late" },
  { id: "family", accessorFn: (r) => r.family, header: "Family" },
  { id: "blocked", accessorFn: (r) => (r.blocker ? "blocked" : "clear"), header: "Blocked" },
];

export function WorkOrderTable({ rows, families, centers }: { rows: WoRow[]; families: string[]; centers: string[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      csvName="work-orders"
      searchPlaceholder="Search WO, SKU, product…"
      rowHref={(r) => `/production/work-orders/${r.id}`}
      hiddenColumns={["scope", "late", "family", "blocked"]}
      filters={[
        { id: "scope", label: "Scope", options: [{ value: "open", label: "Open (released, in progress, on hold)" }, { value: "draft", label: "Drafts" }, { value: "done", label: "Completed / closed / canceled" }] },
        { id: "status", label: "Status", options: ["draft", "released", "in_progress", "on_hold", "completed", "closed", "canceled"].map((s) => ({ value: s, label: s.replace("_", " ") })) },
        { id: "late", label: "Late", options: [{ value: "late", label: "Late only" }] },
        { id: "blocked", label: "Blocked", options: [{ value: "blocked", label: "Blocked only" }] },
        { id: "workCenter", label: "Line", options: centers.map((c) => ({ value: c, label: c })) },
        { id: "family", label: "Family", options: families.map((f) => ({ value: f, label: f })) },
      ]}
    />
  );
}
