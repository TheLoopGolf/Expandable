"use client";

import { useState } from "react";
import { ChartColumn, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LegendItem {
  label: string;
  color: string;
  kind?: "bar" | "line" | "dot";
}

export function LegendKey({ item }: { item: LegendItem }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {item.kind === "line" ? (
        <span className="h-0.5 w-3.5 rounded-full" style={{ background: item.color }} aria-hidden />
      ) : (
        <span className={cn("size-2.5", item.kind === "dot" ? "rounded-full" : "rounded-[3px]")} style={{ background: item.color }} aria-hidden />
      )}
      {item.label}
    </span>
  );
}

/**
 * Card wrapper for charts: title, legend (always present for ≥2 series) and a
 * table-view twin so no value is reachable only by hovering.
 */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  summary,
  children,
  className,
  height = 260,
}: {
  title: string;
  subtitle?: React.ReactNode;
  legend?: LegendItem[];
  table?: { columns: string[]; rows: (string | number)[][] };
  summary?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  height?: number;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border bg-card", className)} aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {table && (
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Chart or table view">
            <button
              type="button"
              onClick={() => setView("chart")}
              aria-pressed={view === "chart"}
              className={cn("rounded px-1.5 py-1 text-muted-foreground", view === "chart" && "bg-muted text-foreground")}
              aria-label="Chart view"
            >
              <ChartColumn className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView("table")}
              aria-pressed={view === "table"}
              className={cn("rounded px-1.5 py-1 text-muted-foreground", view === "table" && "bg-muted text-foreground")}
              aria-label="Table view"
            >
              <Table2 className="size-3.5" />
            </button>
          </div>
        )}
      </div>
      {summary && <div className="px-4 pt-2">{summary}</div>}
      {legend && legend.length > 1 && view === "chart" && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-2.5">
          {legend.map((l) => (
            <LegendKey key={l.label} item={l} />
          ))}
        </div>
      )}
      <div className="px-2 pt-2 pb-3" style={{ minHeight: height }}>
        {view === "chart" || !table ? (
          <div style={{ height }}>{children}</div>
        ) : (
          <div className="max-h-[320px] overflow-auto px-2">
            <table className="w-full text-xs tabular">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-muted-foreground">
                  {table.columns.map((c, i) => (
                    <th key={c} className={cn("py-1.5 font-medium", i > 0 && "text-right")}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/60">
                    {r.map((cell, j) => (
                      <td key={j} className={cn("py-1.5", j > 0 && "text-right")}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export function ChartTooltip({
  active,
  label,
  rows,
}: {
  active?: boolean;
  label?: React.ReactNode;
  rows: { label: string; value: string; color: string; kind?: "bar" | "line" }[];
}) {
  if (!active) return null;
  return (
    <div className="min-w-[160px] rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      {label && <div className="mb-1.5 font-medium text-muted-foreground">{label}</div>}
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <span className={cn("shrink-0", r.kind === "line" ? "h-0.5 w-3 rounded-full" : "h-0.5 w-3 rounded-full")} style={{ background: r.color }} aria-hidden />
            <span className="font-semibold tabular text-foreground">{r.value}</span>
            <span className="text-muted-foreground">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
