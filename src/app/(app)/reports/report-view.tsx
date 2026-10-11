"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ColumnChart, TrendLineChart } from "@/components/charts/simple-charts";
import { DataTable } from "@/components/data-table";
import { StatCard } from "@/components/detail";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/format";
import type { CellFormat, ReportResult } from "@/server/queries/reports";

type Row = Record<string, string | number | null>;

function formatCell(v: string | number | null, f: CellFormat | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  switch (f) {
    case "currency":
      return formatCurrency(v);
    case "number":
      return formatNumber(v, 1);
    case "percent":
      return formatPercent(Number(v));
    case "date":
      return formatDate(String(v));
    default:
      return String(v);
  }
}

export function ReportView({ result, csvName }: { result: ReportResult; csvName: string }) {
  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () =>
      result.table.columns.map((c) => ({
        accessorKey: c.key,
        header: c.label,
        sortUndefined: "last",
        meta: { align: c.format && c.format !== "text" && c.format !== "date" ? "right" : "left" },
        cell: ({ row }) => {
          const value = formatCell(row.original[c.key], c.format);
          const href = c.hrefKey ? row.original[c.hrefKey] : null;
          return href ? (
            <Link href={String(href)} className="font-medium text-primary hover:underline">
              {value}
            </Link>
          ) : (
            <span className="tabular-nums">{value}</span>
          );
        },
      })),
    [result.table.columns],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {result.stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} tone={s.tone === "bad" ? "danger" : s.tone === "good" ? "success" : undefined} />
        ))}
      </div>
      {result.charts.length > 0 && (
        <div className={result.charts.length > 1 ? "grid gap-4 xl:grid-cols-2" : "grid gap-4"}>
          {result.charts.map((c) =>
            c.kind === "line" ? (
              <TrendLineChart key={c.title} title={c.title} subtitle={c.subtitle} data={c.data} xKey="label" series={c.series} format={c.format} />
            ) : (
              <ColumnChart
                key={c.title}
                title={c.title}
                subtitle={c.subtitle}
                data={c.data as Record<string, string | number>[]}
                xKey="label"
                series={c.series}
                format={c.format}
                stacked={c.stacked}
              />
            ),
          )}
        </div>
      )}
      <div>
        <h2 className="mb-2 text-sm font-semibold">{result.table.title}</h2>
        <DataTable
          data={result.table.rows}
          columns={columns}
          csvName={csvName}
          syncUrl={false}
          pageSize={25}
          searchPlaceholder="Search rows…"
          empty="No activity in this period."
        />
      </div>
    </div>
  );
}
