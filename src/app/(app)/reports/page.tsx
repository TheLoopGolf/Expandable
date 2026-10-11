import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Boxes, ClipboardCheck, Factory, Info, ShoppingCart, Truck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { REPORTS, isReportKey, runReport, type ReportKey } from "@/server/queries/reports";
import { cn } from "@/lib/utils";
import { ReportView } from "./report-view";

export const metadata: Metadata = { title: "Reports" };

const CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  Sales: ShoppingCart,
  Production: Factory,
  Inventory: Boxes,
  Purchasing: Truck,
  Quality: ClipboardCheck,
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ report?: string }> }) {
  const user = await requirePermission("reports.view");
  const sp = await searchParams;
  const key: ReportKey | null = isReportKey(sp.report) ? sp.report : null;
  const siteName = user.siteId ? (user.sites.find((s) => s.id === user.siteId)?.name ?? "Selected plant") : "All plants";
  const scope = `${user.range.label} · ${siteName}`;

  if (!key) {
    return (
      <>
        <PageHeader
          title="Reports"
          description="Operational reports computed live from posted transactions. Each report states its definition, follows the date range and plant selected in the top bar, and exports to CSV."
          breadcrumbs={[{ label: "Reporting" }, { label: "Reports" }]}
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {REPORTS.map((r) => {
            const Icon = CATEGORY_ICON[r.category] ?? BarChart3;
            return (
              <Link
                key={r.key}
                href={`/reports?report=${r.key}`}
                className="group flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Icon className="size-3.5" />
                  {r.category}
                </div>
                <div className="mt-2 font-semibold group-hover:text-primary">{r.title}</div>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{r.summary}</p>
              </Link>
            );
          })}
        </div>
      </>
    );
  }

  const meta = REPORTS.find((r) => r.key === key)!;
  const db = await getDb();
  const result = await runReport(db, user.ctx, key, { range: user.range, today: user.today, siteId: user.siteId });

  return (
    <>
      <PageHeader
        title={meta.title}
        description={`${meta.summary} ${scope}.`}
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: meta.title }]}
      />
      <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Reports" className="lg:sticky lg:top-20 lg:self-start">
          <ul className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
            {REPORTS.map((r) => (
              <li key={r.key} className="shrink-0">
                <Link
                  href={`/reports?report=${r.key}`}
                  aria-current={r.key === key ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-2.5 py-1.5 text-[13px] whitespace-nowrap lg:whitespace-normal",
                    r.key === key ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-4">
          <div className="flex gap-2.5 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            <div>
              <span className="font-medium text-foreground">Definition. </span>
              {meta.definition}
            </div>
          </div>
          <ReportView result={result} csvName={`${key}-${user.range.from}-to-${user.range.to}`} />
        </div>
      </div>
    </>
  );
}
