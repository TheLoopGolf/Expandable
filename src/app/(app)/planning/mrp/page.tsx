import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Section, StatCard } from "@/components/detail";
import { EmptyState } from "@/components/empty-state";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { getMrpWorkbench } from "@/server/queries/planning";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ItemPicker, RunMrpControls, SuggestionsTable } from "./workbench";

export const metadata: Metadata = { title: "MRP workbench" };

export default async function MrpPage({ searchParams }: { searchParams: Promise<{ item?: string; horizon?: string }> }) {
  const user = await requirePermission("production.view");
  const sp = await searchParams;
  const horizon = [30, 60, 90, 120, 180].includes(Number(sp.horizon)) ? Number(sp.horizon) : 60;
  const db = await getDb();
  const wb = await getMrpWorkbench(db, user.ctx, { siteId: user.siteId, horizonDays: horizon, itemId: sp.item });
  const can = (p: string) => user.permissions.includes(p as never);
  const open = wb.suggestions.filter((s) => s.status === "open");
  const site = user.sites.find((s) => s.id === user.siteId);
  return (
    <>
      <PageHeader
        title="MRP workbench"
        description="Time-phased material requirements from confirmed sales demand and open work orders, netted against usable stock, safety stock and open supply. Suggestions are never executed automatically — approval creates draft documents."
        breadcrumbs={[{ label: "Planning" }, { label: "MRP" }]}
        actions={<RunMrpControls horizon={horizon} siteId={user.siteId} canRun={can("planning.run")} />}
        meta={
          wb.latest ? (
            <span>
              Last run {wb.latest.run_number} by {wb.latest.created_by} · {formatDateTime(wb.latest.started_at, user.org.timezone)} · {wb.latest.horizon_days}-day horizon · {wb.latest.site ?? "all plants"}. Running now plans{" "}
              {site ? site.name : "all plants"} (top-bar filter).
            </span>
          ) : (
            <span>MRP has not been run yet.</span>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Open suggestions" value={open.length} sub={wb.latest ? `of ${wb.suggestions.length} in ${wb.latest.run_number}` : undefined} />
        <StatCard label="Late releases" value={open.filter((s) => s.is_late).length} tone={open.some((s) => s.is_late) ? "danger" : undefined} sub="Release date already passed" />
        <StatCard label="Buy" value={open.filter((s) => s.suggestion_type === "purchase").length} />
        <StatCard label="Make" value={open.filter((s) => s.suggestion_type === "manufacture").length} />
        <StatCard label="Live preview" value={wb.liveCount} sub={`Suggestions if re-run now (${horizon} d)`} />
      </div>
      <Section title="Planned order suggestions" description="Expand a row for the netting explanation and the demand it is pegged to.">
        <SuggestionsTable rows={wb.suggestions} canApprove={can("planning.approve")} />
      </Section>
      <Section
        className="mt-4"
        title="Time-phased view (live)"
        description="Recomputed from current data each time this page loads. Weeks start Monday; projected on hand includes planned receipts."
        actions={wb.plannedItems.length > 0 ? <ItemPicker items={wb.plannedItems} selected={wb.selected} /> : null}
      >
        {wb.projection && wb.selectedItem ? (
          <div className="overflow-x-auto p-4">
            <p className="mb-2 text-xs text-muted-foreground">
              {wb.selectedItem.sku} · lead time {wb.selectedItem.leadTime} d · safety stock {formatNumber(wb.selectedItem.safety)} · starting usable on hand {formatNumber(wb.projection.startingOnHand)}
            </p>
            <table className="w-full min-w-[720px] text-xs tabular">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-1.5 pr-3 text-left font-medium">Week of</th>
                  {wb.projection.buckets.map((b) => (
                    <th key={b.weekStart} className="px-2 py-1.5 text-right font-medium whitespace-nowrap">
                      {formatDate(b.weekStart, { year: false })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Gross requirements", "gross"],
                    ["Scheduled receipts", "scheduled"],
                    ["Planned receipts", "planned"],
                    ["Projected on hand", "projected"],
                  ] as const
                ).map(([label, key]) => (
                  <tr key={key} className="border-b border-border/60">
                    <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{label}</td>
                    {wb.projection!.buckets.map((b) => (
                      <td
                        key={b.weekStart}
                        className={cn(
                          "px-2 py-1.5 text-right",
                          key === "projected" && b.projected < wb.selectedItem!.safety && "font-semibold text-destructive",
                          key !== "projected" && b[key] === 0 && "text-muted-foreground/50",
                        )}
                      >
                        {formatNumber(b[key], 2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No items with activity in the horizon" className="m-4" />
        )}
      </Section>
    </>
  );
}
