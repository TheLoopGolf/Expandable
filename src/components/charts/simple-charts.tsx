"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact, formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { ChartCard, ChartTooltip } from "./chart-card";

type Fmt = "currency" | "number" | "percent";
const fmt = (v: number, f: Fmt) => (f === "currency" ? formatCurrency(v) : f === "percent" ? formatPercent(v) : formatNumber(v, 1));
const axisFmt = (v: number, f: Fmt) => (f === "currency" ? `$${formatCompact(v)}` : f === "percent" ? `${v}%` : formatCompact(v));
const tick = { fill: "var(--chart-muted)", fontSize: 11 };

export interface Series {
  key: string;
  label: string;
  color: string;
}

/** Grouped (or single-series) column chart with legend, hover tooltip and table view. */
export function ColumnChart({
  title,
  subtitle,
  data,
  xKey,
  series,
  format = "number",
  stacked,
  height = 240,
}: {
  title: string;
  subtitle?: React.ReactNode;
  data: Record<string, string | number>[];
  xKey: string;
  series: Series[];
  format?: Fmt;
  stacked?: boolean;
  height?: number;
}) {
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      height={height}
      legend={series.map((s) => ({ label: s.label, color: s.color }))}
      table={{ columns: [xKey === "label" ? "Period" : xKey, ...series.map((s) => s.label)], rows: data.map((d) => [String(d[xKey]), ...series.map((s) => fmt(Number(d[s.key] ?? 0), format))]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey={xKey} tick={tick} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} interval="preserveStartEnd" minTickGap={10} />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={50} tickFormatter={(v: number) => axisFmt(v, format)} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={({ active, payload, label }) => (
              <ChartTooltip active={active} label={label} rows={series.map((s) => ({ label: s.label, value: fmt(Number(payload?.[0]?.payload?.[s.key] ?? 0), format), color: s.color }))} />
            )}
          />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={s.color}
              stackId={stacked ? "s" : undefined}
              stroke={stacked ? "var(--chart-surface)" : undefined}
              strokeWidth={stacked ? 2 : 0}
              radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : undefined}
              maxBarSize={stacked ? 32 : 22}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Line chart for rates and trends (one axis). */
export function TrendLineChart({
  title,
  subtitle,
  data,
  xKey,
  series,
  format = "number",
  height = 240,
}: {
  title: string;
  subtitle?: React.ReactNode;
  data: Record<string, string | number | null>[];
  xKey: string;
  series: Series[];
  format?: Fmt;
  height?: number;
}) {
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      height={height}
      legend={series.map((s) => ({ label: s.label, color: s.color, kind: "line" as const }))}
      table={{ columns: ["Period", ...series.map((s) => s.label)], rows: data.map((d) => [String(d[xKey]), ...series.map((s) => (d[s.key] === null ? "—" : fmt(Number(d[s.key]), format)))]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey={xKey} tick={tick} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} interval="preserveStartEnd" minTickGap={10} />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => axisFmt(v, format)} domain={format === "percent" ? [0, 100] : undefined} />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                label={label}
                rows={series.map((s) => {
                  const v = payload?.[0]?.payload?.[s.key];
                  return { label: s.label, value: v === null || v === undefined ? "—" : fmt(Number(v), format), color: s.color, kind: "line" as const };
                })}
              />
            )}
          />
          {series.map((s) => (
            <Line key={s.key} dataKey={s.key} type="linear" stroke={s.color} strokeWidth={2} connectNulls dot={{ r: 3, fill: s.color, stroke: "var(--chart-surface)", strokeWidth: 2 }} activeDot={{ r: 4 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
