"use client";

import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact, formatCurrency, formatNumber } from "@/lib/format";
import { ChartCard, ChartTooltip } from "./chart-card";

const axisTick = { fill: "var(--chart-muted)", fontSize: 11 };
const money = (v: number) => (Math.abs(v) >= 1000 ? `$${formatCompact(v)}` : `$${v}`);

export interface TrendPoint {
  bucket: string;
  label: string;
  a: number;
  b: number;
}

export function OrderTrendChart({ points, grain, totals }: { points: TrendPoint[]; grain: "week" | "month"; totals: { intake: number; shipped: number } }) {
  return (
    <ChartCard
      title="Order intake vs shipped revenue"
      subtitle={`By ${grain} · ${formatCurrency(totals.intake, { compact: true })} booked, ${formatCurrency(totals.shipped, { compact: true })} shipped`}
      legend={[
        { label: "Order intake", color: "var(--series-1)" },
        { label: "Shipped revenue", color: "var(--series-2)" },
      ]}
      table={{
        columns: [grain === "week" ? "Week of" : "Month", "Order intake", "Shipped revenue"],
        rows: points.map((p) => [p.label, formatCurrency(p.a), formatCurrency(p.b)]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={money} width={48} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                label={`${grain === "week" ? "Week of " : ""}${label}`}
                rows={[
                  { label: "Order intake", value: formatCurrency(Number(payload?.[0]?.payload?.a ?? 0)), color: "var(--series-1)" },
                  { label: "Shipped revenue", value: formatCurrency(Number(payload?.[0]?.payload?.b ?? 0)), color: "var(--series-2)" },
                ]}
              />
            )}
          />
          <Bar dataKey="a" name="Order intake" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="b" name="Shipped revenue" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function ProductionChart({ points, grain, totals }: { points: TrendPoint[]; grain: "week" | "month"; totals: { planned: number; actual: number; scrapRate: number } }) {
  const attainment = totals.planned > 0 ? (totals.actual / totals.planned) * 100 : 0;
  return (
    <ChartCard
      title="Production plan vs actual output"
      subtitle={`Finished-goods units by ${grain} · ${formatNumber(totals.actual, 0)} good of ${formatNumber(totals.planned, 0)} planned (${attainment.toFixed(0)}%) · scrap ${totals.scrapRate.toFixed(1)}%`}
      legend={[
        { label: "Actual good output", color: "var(--series-1)", kind: "bar" },
        { label: "Planned (by due date)", color: "var(--chart-plan)", kind: "line" },
      ]}
      table={{
        columns: [grain === "week" ? "Week of" : "Month", "Planned", "Actual good"],
        rows: points.map((p) => [p.label, formatNumber(p.a, 0), formatNumber(p.b, 0)]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => formatCompact(v)} />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                label={`${grain === "week" ? "Week of " : ""}${label}`}
                rows={[
                  { label: "Actual good", value: formatNumber(Number(payload?.[0]?.payload?.b ?? 0), 0), color: "var(--series-1)" },
                  { label: "Planned", value: formatNumber(Number(payload?.[0]?.payload?.a ?? 0), 0), color: "var(--chart-plan)", kind: "line" },
                ]}
              />
            )}
          />
          <Bar dataKey="b" name="Actual good" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Line dataKey="a" name="Planned" type="linear" stroke="var(--chart-plan)" strokeWidth={2} dot={{ r: 3, fill: "var(--chart-plan)", stroke: "var(--chart-surface)", strokeWidth: 2 }} activeDot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export interface BacklogRow {
  bucket: string;
  confirmed: number;
  partially_shipped: number;
  on_hold: number;
}

const BACKLOG_SERIES = [
  { key: "confirmed", label: "Confirmed", color: "var(--series-1)" },
  { key: "partially_shipped", label: "Partially shipped", color: "var(--series-2)" },
  { key: "on_hold", label: "On hold", color: "var(--series-3)" },
] as const;

export function BacklogChart({ rows }: { rows: BacklogRow[] }) {
  const total = rows.reduce((s, r) => s + r.confirmed + r.partially_shipped + r.on_hold, 0);
  return (
    <ChartCard
      title="Order backlog by promised ship date"
      subtitle={`${formatCurrency(total, { compact: true })} open across confirmed, partially shipped and on-hold orders`}
      legend={BACKLOG_SERIES.map((s) => ({ label: s.label, color: s.color }))}
      table={{
        columns: ["Promised", ...BACKLOG_SERIES.map((s) => s.label)],
        rows: rows.map((r) => [r.bucket, ...BACKLOG_SERIES.map((s) => formatCurrency(r[s.key]))]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="bucket" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--chart-axis)" }} interval={0} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={money} width={48} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                label={label}
                rows={BACKLOG_SERIES.map((s) => ({ label: s.label, value: formatCurrency(Number(payload?.[0]?.payload?.[s.key] ?? 0)), color: s.color }))}
              />
            )}
          />
          {BACKLOG_SERIES.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="backlog"
              fill={s.color}
              stroke="var(--chart-surface)"
              strokeWidth={2}
              maxBarSize={36}
              radius={i === BACKLOG_SERIES.length - 1 ? [4, 4, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "var(--status-critical)",
  high: "var(--status-serious)",
  medium: "var(--status-warning)",
  low: "var(--chart-muted)",
};

export function SeverityChart({ data }: { data: { severity: string; count: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: d.severity[0].toUpperCase() + d.severity.slice(1), color: SEVERITY_COLORS[d.severity] }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 4 }} barCategoryGap="26%">
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="label" tick={axisTick} tickLine={false} axisLine={false} width={64} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={({ active, payload }) => (
            <ChartTooltip
              active={active}
              rows={payload?.[0] ? [{ label: `${payload[0].payload.label} severity open`, value: String(payload[0].payload.count), color: payload[0].payload.color }] : []}
            />
          )}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={r.severity} fill={r.color} />
          ))}
          <LabelList dataKey="count" position="right" style={{ fill: "var(--chart-ink)", fontSize: 11, fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
