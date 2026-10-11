"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge, ToneBadge } from "@/components/status-badge";
import { useServerAction } from "@/components/action-button";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { approveSuggestionsAction, dismissSuggestionAction, runMrpAction } from "../actions";

export interface SuggestionRow {
  id: string;
  suggestion_type: string;
  item_id: string;
  sku: string;
  name: string;
  uom: string;
  supplier: string | null;
  quantity: number;
  value: number;
  need_date: string;
  release_date: string;
  is_late: boolean;
  explanation: string;
  pegging: { type: string; ref: string; id?: string; date: string; quantity: string }[];
  status: string;
  created_document_type: string | null;
  created_document_id: string | null;
  created_document_number: string | null;
}

const PEG_HREF: Record<string, (id: string) => string> = {
  sales_order: (id) => `/sales/orders/${id}`,
  work_order: (id) => `/production/work-orders/${id}`,
  purchase_order: (id) => `/purchasing/orders/${id}`,
};

export function RunMrpControls({ horizon, siteId, canRun }: { horizon: number; siteId: string | null; canRun: boolean }) {
  const [h, setH] = useState(horizon);
  const { pending, run } = useServerAction();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
        Horizon
        <select
          value={h}
          onChange={(e) => {
            setH(Number(e.target.value));
            const next = new URLSearchParams(params.toString());
            next.set("horizon", e.target.value);
            router.replace(`${pathname}?${next}`, { scroll: false });
          }}
          className="h-8 rounded-md border bg-card px-2 text-[13px] text-foreground"
        >
          {[30, 60, 90, 120, 180].map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </label>
      {canRun && (
        <Button size="sm" onClick={() => run(() => runMrpAction(h, siteId))} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <PlayCircle />}Run MRP
        </Button>
      )}
    </div>
  );
}

export function SuggestionsTable({ rows, canApprove }: { rows: SuggestionRow[]; canApprove: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { pending, run } = useServerAction();
  const open = rows.filter((r) => r.status === "open");
  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };
  const selectedValue = rows.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.value, 0);
  return (
    <div>
      {canApprove && open.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <Button size="sm" variant="outline" onClick={() => setSelected(selected.size === open.length ? new Set() : new Set(open.map((r) => r.id)))}>
            {selected.size === open.length ? "Clear selection" : "Select all open"}
          </Button>
          <Button size="sm" disabled={selected.size === 0 || pending} onClick={() => run(() => approveSuggestionsAction([...selected]), () => setSelected(new Set()))}>
            {pending && <Loader2 className="animate-spin" />}
            Approve {selected.size || ""} → create drafts
          </Button>
          {selected.size > 0 && <span className="text-xs text-muted-foreground">≈ {formatCurrency(selectedValue)} at standard cost. Purchase drafts are grouped by supplier; nothing is sent to suppliers.</span>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-[13px]">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="w-8 px-4 py-2" />
              <th className="px-2 py-2 font-medium">Action</th>
              <th className="px-2 py-2 font-medium">Item</th>
              <th className="px-2 py-2 text-right font-medium">Quantity</th>
              <th className="px-2 py-2 font-medium">Release by</th>
              <th className="px-2 py-2 font-medium">Need date</th>
              <th className="px-2 py-2 font-medium">Supplier</th>
              <th className="px-2 py-2 text-right font-medium">Value</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No suggestions — supply covers demand and safety stock within the horizon.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isOpen = expanded.has(r.id);
              return (
                <Fragment key={r.id}>
                  <tr className={cn("border-b border-border/60", r.status !== "open" && "text-muted-foreground")}>
                    <td className="px-4 py-2">
                      {r.status === "open" && canApprove && (
                        <Checkbox checked={selected.has(r.id)} onCheckedChange={() => setSelected((s) => toggle(s, r.id))} aria-label={`Select suggestion for ${r.sku}`} />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <ToneBadge tone={r.suggestion_type === "purchase" ? "info" : "progress"} dot={false}>
                        {r.suggestion_type === "purchase" ? "Buy" : "Make"}
                      </ToneBadge>
                    </td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => setExpanded((s) => toggle(s, r.id))} className="flex items-center gap-1 text-left" aria-expanded={isOpen}>
                        {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                        <span className="font-medium">{r.sku}</span>
                      </button>
                      <div className="ml-[18px] max-w-[260px] truncate text-xs text-muted-foreground">{r.name}</div>
                    </td>
                    <td className="px-2 py-2 text-right tabular font-medium">
                      {formatNumber(r.quantity)} {r.uom !== "ea" ? r.uom : ""}
                    </td>
                    <td className={cn("px-2 py-2 whitespace-nowrap", r.is_late && r.status === "open" && "font-medium text-destructive")}>
                      {formatDate(r.release_date, { year: false })}
                      {r.is_late && r.status === "open" && " · late"}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{formatDate(r.need_date, { year: false })}</td>
                    <td className="px-2 py-2 text-xs">{r.supplier ?? (r.suggestion_type === "purchase" ? <span className="text-destructive">No supplier</span> : "In-house")}</td>
                    <td className="px-2 py-2 text-right tabular">{formatCurrency(r.value)}</td>
                    <td className="px-2 py-2">
                      {r.created_document_id ? (
                        <Link href={r.created_document_type === "purchase_order" ? `/purchasing/orders/${r.created_document_id}` : `/production/work-orders/${r.created_document_id}`} className="text-xs text-primary hover:underline">
                          {r.created_document_number}
                        </Link>
                      ) : (
                        <StatusBadge status={r.status} />
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {r.status === "open" && canApprove && (
                        <Button size="xs" variant="ghost" onClick={() => run(() => dismissSuggestionAction(r.id))} disabled={pending}>
                          Dismiss
                        </Button>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b bg-muted/30">
                      <td />
                      <td colSpan={9} className="px-2 py-3">
                        <p className="max-w-4xl text-xs leading-relaxed">{r.explanation}</p>
                        {r.pegging.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span className="text-xs text-muted-foreground">Pegged to:</span>
                            {r.pegging.map((p, i) => {
                              const href = p.id ? PEG_HREF[p.type]?.(p.id) : null;
                              const label = `${p.ref} · ${formatNumber(p.quantity)} on ${formatDate(p.date, { year: false })}`;
                              return href ? (
                                <Link key={i} href={href} className="rounded border bg-card px-1.5 py-0.5 text-xs hover:border-primary/50">
                                  {label}
                                </Link>
                              ) : (
                                <span key={i} className="rounded border bg-card px-1.5 py-0.5 text-xs">
                                  {label}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ItemPicker({ items, selected }: { items: { id: string; sku: string; name: string }[]; selected: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select
      value={selected ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        next.set("item", e.target.value);
        router.replace(`${pathname}?${next}`, { scroll: false });
      }}
      className="h-8 max-w-[320px] rounded-md border bg-card px-2 text-[13px]"
      aria-label="Item for time-phased view"
    >
      {items.map((i) => (
        <option key={i.id} value={i.id}>
          {i.sku} — {i.name}
        </option>
      ))}
    </select>
  );
}
