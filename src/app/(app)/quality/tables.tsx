"use client";

import { useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, Plus, ShieldAlert } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { SeverityBadge, StatusBadge, ToneBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, selectClass } from "@/components/field";
import { useServerAction } from "@/components/action-button";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { recordInspectionAction } from "./actions";

export interface EventRow {
  id: string;
  event_number: string;
  event_type: string;
  title: string;
  severity: string;
  status: string;
  source: string;
  disposition: string | null;
  sku: string | null;
  lot_number: string | null;
  owner: string | null;
  due_date: string | null;
  opened_at: string;
  supplier: string | null;
  customer: string | null;
  capas: number;
  hold_active: boolean;
  overdue: boolean;
  scope: string;
}

const TYPE_LABEL: Record<string, string> = { ncr: "NCR", complaint: "Complaint", deviation: "Deviation", audit_finding: "Audit finding" };

const eventColumns: ColumnDef<EventRow, unknown>[] = [
  {
    accessorKey: "event_number",
    header: "Event",
    cell: ({ row }) => (
      <Link href={`/quality/events/${row.original.id}`} className="font-medium whitespace-nowrap text-primary hover:underline">
        {row.original.event_number}
      </Link>
    ),
  },
  { id: "event_type", accessorFn: (r) => r.event_type, header: "Type", cell: ({ getValue }) => TYPE_LABEL[getValue() as string] ?? (getValue() as string) },
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => (
      <div className="max-w-[320px]">
        <div className="truncate">{row.original.title}</div>
        <div className="text-xs text-muted-foreground">
          {[row.original.sku, row.original.lot_number && `lot ${row.original.lot_number}`, row.original.supplier, row.original.customer].filter(Boolean).join(" · ")}
        </div>
      </div>
    ),
  },
  { id: "severity", accessorFn: (r) => r.severity, header: "Severity", cell: ({ getValue }) => <SeverityBadge severity={getValue() as string} /> },
  {
    id: "status",
    accessorFn: (r) => r.status,
    header: "Status",
    cell: ({ row }) => (
      <span className="flex flex-wrap gap-1">
        <StatusBadge status={row.original.status} />
        {row.original.hold_active && (
          <ToneBadge tone="warning" dot={false}>
            <ShieldAlert className="size-3" /> Hold
          </ToneBadge>
        )}
      </span>
    ),
  },
  { id: "source", accessorFn: (r) => r.source, header: "Source", cell: ({ getValue }) => <span className="capitalize text-muted-foreground">{(getValue() as string).replace("_", "-")}</span> },
  { accessorKey: "owner", header: "Owner", cell: ({ getValue }) => (getValue() as string) ?? "—" },
  { accessorKey: "due_date", header: "Due", cell: ({ row }) => <span className={row.original.overdue ? "font-medium text-destructive" : ""}>{formatDate(row.original.due_date, { year: false })}</span> },
  { accessorKey: "opened_at", header: "Opened", cell: ({ getValue }) => formatDate((getValue() as string).slice(0, 10)) },
  { accessorKey: "capas", header: "CAPA", meta: { align: "right" } },
  { id: "scope", accessorFn: (r) => r.scope, header: "Scope" },
];

export function EventsTable({ rows }: { rows: EventRow[] }) {
  return (
    <DataTable
      columns={eventColumns}
      data={rows}
      csvName="quality-events"
      searchPlaceholder="Search event, title, SKU, lot…"
      rowHref={(r) => `/quality/events/${r.id}`}
      hiddenColumns={["scope"]}
      filters={[
        { id: "scope", label: "Scope", options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed / canceled" }] },
        { id: "severity", label: "Severity", options: ["critical", "high", "medium", "low"].map((s) => ({ value: s, label: s })) },
        { id: "event_type", label: "Type", options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })) },
        { id: "source", label: "Source", options: ["incoming", "in_process", "final", "customer", "internal"].map((s) => ({ value: s, label: s.replace("_", "-") })) },
      ]}
    />
  );
}

export interface InspectionRow {
  id: string;
  inspection_number: string;
  inspection_type: string;
  sku: string;
  lot_number: string | null;
  po_number: string | null;
  wo_number: string | null;
  quantity_inspected: string;
  quantity_rejected: string;
  result: string;
  inspector: string | null;
  inspected_at: string;
  notes: string | null;
}

export function InspectionsTable({ rows, timeZone }: { rows: InspectionRow[]; timeZone: string }) {
  const columns: ColumnDef<InspectionRow, unknown>[] = [
    { accessorKey: "inspection_number", header: "Inspection" },
    { id: "inspection_type", accessorFn: (r) => r.inspection_type, header: "Type", cell: ({ getValue }) => <span className="capitalize">{(getValue() as string).replace("_", "-")}</span> },
    { accessorKey: "sku", header: "Item" },
    { accessorKey: "lot_number", header: "Lot", cell: ({ getValue }) => (getValue() ? <Link href={`/inventory/lots?lot=${encodeURIComponent(getValue() as string)}`} className="font-mono text-xs hover:underline">{getValue() as string}</Link> : "—") },
    { id: "ref", accessorFn: (r) => r.po_number ?? r.wo_number ?? "", header: "Reference" },
    { accessorKey: "quantity_inspected", header: "Inspected", cell: ({ getValue }) => formatNumber(getValue() as string), meta: { align: "right" } },
    { accessorKey: "quantity_rejected", header: "Rejected", cell: ({ getValue }) => formatNumber(getValue() as string), meta: { align: "right" } },
    { id: "result", accessorFn: (r) => r.result, header: "Result", cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: "inspector", header: "Inspector" },
    { accessorKey: "inspected_at", header: "When", cell: ({ getValue }) => formatDateTime(getValue() as string, timeZone) },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      csvName="inspections"
      searchPlaceholder="Search inspection, SKU, lot…"
      filters={[
        { id: "result", label: "Result", options: [{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }] },
        { id: "inspection_type", label: "Type", options: ["incoming", "in_process", "final"].map((s) => ({ value: s, label: s.replace("_", "-") })) },
      ]}
    />
  );
}

export function InspectionDialog({ items, lots }: { items: { id: string; sku: string; name: string }[]; lots: { id: string; lot_number: string; item_id: string }[] }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"incoming" | "in_process" | "final">("incoming");
  const [itemId, setItemId] = useState("");
  const [lotId, setLotId] = useState("");
  const [inspected, setInspected] = useState("");
  const [rejected, setRejected] = useState("0");
  const [result, setResult] = useState<"pass" | "fail">("pass");
  const [notes, setNotes] = useState("");
  const { pending, run } = useServerAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus /> Record inspection
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record inspection</DialogTitle>
          <DialogDescription>A failed inspection does not change lot status by itself — open an NCR with a hold to block the lot.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <select className={selectClass} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="incoming">Incoming</option>
              <option value="in_process">In-process</option>
              <option value="final">Final</option>
            </select>
          </Field>
          <Field label="Result">
            <select className={selectClass} value={result} onChange={(e) => setResult(e.target.value as typeof result)}>
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
            </select>
          </Field>
          <Field label="Item" className="sm:col-span-2">
            <select className={selectClass} value={itemId} onChange={(e) => (setItemId(e.target.value), setLotId(""))}>
              <option value="">Select item…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.sku} — {i.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Lot (optional)" className="sm:col-span-2">
            <select className={selectClass} value={lotId} onChange={(e) => setLotId(e.target.value)}>
              <option value="">None</option>
              {lots.filter((l) => l.item_id === itemId).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.lot_number}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity inspected">
            <Input inputMode="decimal" value={inspected} onChange={(e) => setInspected(e.target.value)} />
          </Field>
          <Field label="Quantity rejected">
            <Input inputMode="decimal" value={rejected} onChange={(e) => setRejected(e.target.value)} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !itemId || !inspected}
            onClick={() => run(() => recordInspectionAction({ inspectionType: type, itemId, lotId: lotId || null, quantityInspected: inspected, quantityRejected: rejected || "0", result, notes }), () => setOpen(false))}
          >
            {pending && <Loader2 className="animate-spin" />}Save inspection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
