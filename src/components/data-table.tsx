"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface FilterDef {
  id: string;
  label: string;
  options: { value: string; label: string }[];
}

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** Value written to CSV exports (defaults to the accessor value). */
    csv?: (row: TData) => string | number | null | undefined;
    align?: "left" | "right" | "center";
    className?: string;
    headerClassName?: string;
  }
}

const equalsOrIn: FilterFn<unknown> = (row, columnId, value) => {
  if (value === undefined || value === null || value === "") return true;
  const cell = row.getValue(columnId);
  if (Array.isArray(cell)) return cell.includes(value);
  return String(cell) === String(value);
};

function toCsv<T>(rows: T[], columns: ColumnDef<T, unknown>[]): string {
  const exportable = columns.filter((c) => c.header && typeof c.header === "string" && ("accessorKey" in c || c.meta?.csv));
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = exportable.map((c) => esc(c.header)).join(",");
  const lines = rows.map((r) =>
    exportable
      .map((c) => {
        if (c.meta?.csv) return esc(c.meta.csv(r));
        const key = (c as { accessorKey?: string }).accessorKey;
        return esc(key ? (r as Record<string, unknown>)[key] : "");
      })
      .join(","),
  );
  return [header, ...lines].join("\n");
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Interactive operational grid: sorting, global search, select filters synced to the URL
 * (shareable), pagination, keyboard row navigation and CSV export of the filtered rows.
 */
export function DataTable<T>({
  columns,
  data,
  filters = [],
  searchPlaceholder = "Search…",
  csvName,
  rowHref,
  initialSort,
  pageSize = 25,
  toolbar,
  empty,
  syncUrl = true,
  dense,
  hiddenColumns = [],
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  filters?: FilterDef[];
  searchPlaceholder?: string;
  csvName?: string;
  rowHref?: (row: T) => string | null;
  initialSort?: SortingState;
  pageSize?: number;
  toolbar?: React.ReactNode;
  empty?: React.ReactNode;
  syncUrl?: boolean;
  dense?: boolean;
  /** Columns used only for filtering (not rendered). */
  hiddenColumns?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? []);
  const [globalFilter, setGlobalFilter] = useState(() => (syncUrl ? params.get("q") ?? "" : ""));
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() =>
    syncUrl ? filters.filter((f) => params.get(f.id)).map((f) => ({ id: f.id, value: params.get(f.id) })) : [],
  );

  useEffect(() => {
    if (!syncUrl) return;
    const next = new URLSearchParams(params.toString());
    if (globalFilter) next.set("q", globalFilter);
    else next.delete("q");
    for (const f of filters) {
      const v = columnFilters.find((c) => c.id === f.id)?.value as string | undefined;
      if (v) next.set(f.id, v);
      else next.delete(f.id);
    }
    const qs = next.toString();
    if (qs !== params.toString()) {
      const handle = setTimeout(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }), 250);
      return () => clearTimeout(handle);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalFilter, columnFilters]);

  const filterIds = useMemo(() => new Set(filters.map((f) => f.id)), [filters]);
  const cols = useMemo(
    () => columns.map((c) => (c.id && filterIds.has(c.id)) || ("accessorKey" in c && filterIds.has(String(c.accessorKey))) ? { ...c, filterFn: c.filterFn ?? (equalsOrIn as FilterFn<T>) } : c),
    [columns, filterIds],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: cols,
    state: { sorting, globalFilter, columnFilters, columnVisibility: Object.fromEntries(hiddenColumns.map((c) => [c, false])) },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: "includesString",
    initialState: { pagination: { pageSize } },
    autoResetPageIndex: true,
  });

  const rows = table.getRowModel().rows;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const active = globalFilter || columnFilters.length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} placeholder={searchPlaceholder} className="h-8 pl-8 text-[13px]" aria-label="Search table" />
        </div>
        {filters.map((f) => {
          const value = (columnFilters.find((c) => c.id === f.id)?.value as string) ?? "";
          return (
            <select
              key={f.id}
              value={value}
              onChange={(e) => table.getColumn(f.id)?.setFilterValue(e.target.value || undefined)}
              aria-label={f.label}
              className="h-8 rounded-md border bg-card px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">{f.label}: all</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          );
        })}
        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setGlobalFilter("");
              setColumnFilters([]);
            }}
          >
            <X /> Clear
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          {csvName && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  `${csvName}-${new Date().toISOString().slice(0, 10)}.csv`,
                  toCsv(
                    table.getFilteredRowModel().rows.map((r) => r.original),
                    columns,
                  ),
                )
              }
            >
              <Download /> Export CSV
            </Button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b">
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  const dir = h.column.getIsSorted();
                  const align = h.column.columnDef.meta?.align;
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                      className={cn(
                        "px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground first:pl-4 last:pr-4",
                        align === "right" && "text-right",
                        h.column.columnDef.meta?.headerClassName,
                      )}
                    >
                      {h.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className={cn("inline-flex items-center gap-1 hover:text-foreground", align === "right" && "flex-row-reverse")}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length - hiddenColumns.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {active ? "No rows match the current filters." : empty ?? "No records yet."}
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const href = rowHref?.(row.original) ?? null;
              return (
                <tr
                  key={row.id}
                  tabIndex={href ? 0 : undefined}
                  onClick={(e) => {
                    if (!href) return;
                    if ((e.target as HTMLElement).closest("a,button,input,select,label")) return;
                    router.push(href);
                  }}
                  onKeyDown={(e) => {
                    if (href && e.key === "Enter") router.push(href);
                  }}
                  className={cn("border-b border-border/60 last:border-0 hover:bg-muted/40 focus-visible:bg-accent/60 focus-visible:outline-none", href && "cursor-pointer")}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn(
                        "px-3 align-middle first:pl-4 last:pr-4",
                        dense ? "py-1.5" : "py-2",
                        cell.column.columnDef.meta?.align === "right" && "text-right tabular",
                        cell.column.columnDef.meta?.className,
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {filteredCount === data.length ? `${data.length} records` : `${filteredCount} of ${data.length} records`}
        </span>
        {table.getPageCount() > 1 && (
          <div className="flex items-center gap-1">
            <span className="mr-2">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
            <Button variant="outline" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
