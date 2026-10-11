"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { TreeNode } from "@/server/queries/engineering";

export function BomTree({ nodes }: { nodes: TreeNode[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const hidden = useMemo(() => {
    const h = new Set<string>();
    for (const n of nodes) if (n.parentKey && (collapsed.has(n.parentKey) || h.has(n.parentKey))) h.add(n.key);
    return h;
  }, [nodes, collapsed]);
  const toggle = (k: string) => setCollapsed((c) => {
    const next = new Set(c);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return next;
  });
  return (
    <div>
      <div className="flex gap-2 px-4 pt-3">
        <Button size="xs" variant="outline" onClick={() => setCollapsed(new Set())}>Expand all</Button>
        <Button size="xs" variant="outline" onClick={() => setCollapsed(new Set(nodes.filter((n) => n.hasChildren).map((n) => n.key)))}>Collapse all</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13px]" role="treegrid" aria-label="Multi-level BOM">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Component</th>
              <th className="px-2 py-2 text-right font-medium">Qty per</th>
              <th className="px-2 py-2 text-right font-medium">Scrap %</th>
              <th className="px-2 py-2 text-right font-medium">Ext. qty / unit</th>
              <th className="px-2 py-2 text-right font-medium">Unit cost</th>
              <th className="px-4 py-2 text-right font-medium">Ext. cost</th>
            </tr>
          </thead>
          <tbody>
            {nodes.filter((n) => !hidden.has(n.key)).map((n) => (
              <tr key={n.key} className="border-b border-border/50 hover:bg-muted/30" aria-level={n.level} aria-expanded={n.hasChildren ? !collapsed.has(n.key) : undefined}>
                <td className="py-1.5 pr-2" style={{ paddingLeft: 16 + (n.level - 1) * 20 }}>
                  <div className="flex items-center gap-1">
                    {n.hasChildren ? (
                      <button type="button" onClick={() => toggle(n.key)} className="rounded p-0.5 hover:bg-muted" aria-label={collapsed.has(n.key) ? `Expand ${n.sku}` : `Collapse ${n.sku}`}>
                        {collapsed.has(n.key) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                      </button>
                    ) : (
                      <span className="w-[18px]" />
                    )}
                    <Link href={`/inventory/items/${n.itemId}`} className={n.hasChildren ? "font-semibold hover:underline" : "hover:underline"}>
                      {n.sku}
                    </Link>
                    <span className="truncate text-xs text-muted-foreground">{n.name}</span>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right tabular">{formatNumber(n.quantityPer, 4)}</td>
                <td className="px-2 py-1.5 text-right tabular text-muted-foreground">{n.scrapPct ? formatNumber(n.scrapPct, 2) : "—"}</td>
                <td className="px-2 py-1.5 text-right tabular">{formatNumber(n.extendedQty, 4)} {n.uom !== "ea" ? n.uom : ""}</td>
                <td className="px-2 py-1.5 text-right tabular">{formatCurrency(n.unitCost, { cents: true })}</td>
                <td className="px-4 py-1.5 text-right tabular">{n.hasChildren ? <span className="text-xs text-muted-foreground">rolled up</span> : formatCurrency(n.extendedCost, { cents: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
