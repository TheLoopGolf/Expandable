"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { ReasonActionButton } from "@/components/action-button";
import { formatDate, formatNumber } from "@/lib/format";
import { placeHoldOnLotAction, releaseHoldAction, releaseQuarantineAction } from "../actions";

export interface LotRow {
  id: string;
  lot_number: string;
  sku: string;
  item_id: string;
  name: string;
  status: string;
  state: string;
  expires_on: string | null;
  received_on: string | null;
  manufactured_on: string | null;
  origin: string;
  origin_ref: string | null;
  supplier: string | null;
  qty: number;
  locations: string | null;
  hold_id: string | null;
  hold_reason: string | null;
  event_id: string | null;
  event_number: string | null;
  expired: boolean;
}

export function LotTable({ rows, canHold }: { rows: LotRow[]; canHold: boolean }) {
  const columns: ColumnDef<LotRow, unknown>[] = [
    {
      accessorKey: "lot_number",
      header: "Lot",
      cell: ({ row }) => (
        <Link href={`/inventory/lots?lot=${encodeURIComponent(row.original.lot_number)}`} className="font-mono text-xs font-medium text-primary hover:underline" scroll={false}>
          {row.original.lot_number}
        </Link>
      ),
    },
    {
      accessorKey: "sku",
      header: "Item",
      cell: ({ row }) => (
        <Link href={`/inventory/items/${row.original.item_id}`} className="hover:underline">
          {row.original.sku}
        </Link>
      ),
    },
    { id: "state", accessorFn: (r) => r.state, header: "Status", cell: ({ row }) => <StatusBadge status={row.original.state === "consumed" ? "closed" : row.original.state} /> },
    { accessorKey: "qty", header: "On hand", cell: ({ getValue }) => formatNumber(getValue() as number), meta: { align: "right" } },
    { id: "locations", accessorFn: (r) => r.locations ?? "", header: "Location" },
    { accessorKey: "expires_on", header: "Expires", cell: ({ row }) => <span className={row.original.expired ? "font-medium text-destructive" : ""}>{formatDate(row.original.expires_on)}</span> },
    {
      id: "origin",
      accessorFn: (r) => r.origin,
      header: "Origin",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground capitalize">
          {row.original.origin}
          {row.original.origin_ref ? ` · ${row.original.origin_ref}` : ""}
          {row.original.supplier ? ` · ${row.original.supplier}` : ""}
        </span>
      ),
    },
    {
      id: "hold",
      header: "Quality",
      cell: ({ row }) => {
        const l = row.original;
        if (l.hold_id)
          return (
            <div className="flex flex-col items-start gap-1">
              {l.event_id && (
                <Link href={`/quality/events/${l.event_id}`} className="text-xs hover:underline">
                  {l.event_number}
                </Link>
              )}
              {canHold && (
                <ReasonActionButton
                  size="xs"
                  title={`Release hold on ${l.lot_number}`}
                  description={`Hold reason: ${l.hold_reason}. Releasing makes the lot available for issue and shipment.`}
                  label="Release justification"
                  minLength={10}
                  confirmLabel="Release hold"
                  action={(r) => releaseHoldAction(l.hold_id!, r)}
                >
                  Release hold
                </ReasonActionButton>
              )}
            </div>
          );
        if (l.status === "quarantine" && canHold)
          return (
            <ReasonActionButton size="xs" title={`Release ${l.lot_number} from quarantine`} label="Inspection result / reason" minLength={5} action={(r) => releaseQuarantineAction(l.id, r)}>
              Release quarantine
            </ReasonActionButton>
          );
        if (l.qty > 0 && canHold)
          return (
            <ReasonActionButton size="xs" variant="ghost" title={`Place ${l.lot_number} on hold`} label="Hold reason" minLength={5} action={(r) => placeHoldOnLotAction(l.id, r)}>
              Place hold
            </ReasonActionButton>
          );
        return null;
      },
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      csvName="lots"
      searchPlaceholder="Search lot, SKU…"
      filters={[
        {
          id: "state",
          label: "Status",
          options: [
            { value: "available", label: "Available" },
            { value: "hold", label: "On hold" },
            { value: "quarantine", label: "Quarantine" },
            { value: "expired", label: "Expired" },
            { value: "consumed", label: "Consumed" },
          ],
        },
        { id: "origin", label: "Origin", options: ["purchase", "production", "adjustment", "opening"].map((o) => ({ value: o, label: o })) },
      ]}
    />
  );
}
