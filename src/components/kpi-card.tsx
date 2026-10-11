"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCompact, formatCurrency, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Sparkline } from "./charts/sparkline";

export interface KpiCardData {
  key: string;
  label: string;
  value: number;
  format: "currency" | "percent" | "number";
  previous: number | null;
  previousLabel: string | null;
  higherIsBetter: boolean;
  definition: string;
  href: string;
  spark?: number[];
}

function fmt(v: number, format: KpiCardData["format"]) {
  if (format === "currency") return Math.abs(v) >= 100_000 ? formatCurrency(v, { compact: true }) : formatCurrency(v);
  if (format === "percent") return formatPercent(v);
  return formatCompact(v);
}

export function KpiCard({ kpi }: { kpi: KpiCardData }) {
  let delta: { text: string; good: boolean | null; dir: "up" | "down" | "flat" } | null = null;
  if (kpi.previous !== null && kpi.previous !== undefined) {
    const diff = kpi.value - kpi.previous;
    const dir = Math.abs(diff) < 1e-9 ? "flat" : diff > 0 ? "up" : "down";
    let text: string;
    if (kpi.format === "percent") text = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pts`;
    else if (kpi.previous === 0) text = diff === 0 ? "0%" : "new";
    else text = `${diff >= 0 ? "+" : ""}${((diff / Math.abs(kpi.previous)) * 100).toFixed(1)}%`;
    delta = { text, dir, good: dir === "flat" ? null : (dir === "up") === kpi.higherIsBetter };
  }
  const DeltaIcon = delta?.dir === "up" ? ArrowUpRight : delta?.dir === "down" ? ArrowDownRight : Minus;

  return (
    <div className="group relative flex flex-col justify-between gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40" data-testid={`kpi-${kpi.key}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-medium text-muted-foreground">{kpi.label}</div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="relative z-10 -m-1 rounded p-1 text-muted-foreground/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={`How ${kpi.label} is calculated`}>
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-relaxed">{kpi.definition}</TooltipContent>
        </Tooltip>
      </div>
      <div>
        <div>
          <div className="text-[26px] leading-none font-semibold tracking-tight">{fmt(kpi.value, kpi.format)}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
            {delta && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 font-medium",
                  delta.good === null ? "text-muted-foreground" : delta.good ? "text-success" : "text-destructive",
                )}
              >
                <DeltaIcon className="size-3.5" aria-hidden />
                {delta.text}
              </span>
            )}
            {kpi.previousLabel && <span className="text-muted-foreground">{kpi.previousLabel}</span>}
          </div>
        </div>
        {kpi.spark && (
          <div className="mt-2">
            <Sparkline values={kpi.spark} label={`${kpi.label} weekly trend, last 12 weeks`} />
          </div>
        )}
      </div>
      <Link href={kpi.href} className="absolute inset-0 rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={`Open ${kpi.label} details`} />
    </div>
  );
}
