"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { DASHBOARD_VIEWS } from "@/lib/quick-actions";

const VIEWS = DASHBOARD_VIEWS;

export function DashboardControls({ view, family, families }: { view: string; family: string | null; families: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")}>
      <nav aria-label="Dashboard views" className="flex rounded-lg border bg-card p-0.5">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={href({ view: v.key })}
            scroll={false}
            aria-current={view === v.key ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground",
              view === v.key && "bg-secondary text-foreground shadow-xs",
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className="hidden sm:inline">Product family</span>
        <select
          className="h-8 rounded-md border bg-card px-2 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={family ?? ""}
          onChange={(e) => startTransition(() => router.push(href({ family: e.target.value || null }), { scroll: false }))}
          aria-label="Filter by product family"
        >
          <option value="">All families</option>
          {families.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
