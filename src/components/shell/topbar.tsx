"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Bell, Building2, CalendarDays, Check, ChevronsUpDown, LogOut, MapPin, Menu, Monitor, Moon, Search, Sun, UserRoundCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RANGE_PRESETS } from "@/lib/dates";
import { ROLES } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setRangePreference, setSitePreference, signOut, switchOrganization } from "@/app/(app)/shell-actions";
import type { ShellData } from "./types";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function TopBar({ data, onOpenSearch, onOpenMenu }: { data: ShellData; onOpenSearch: () => void; onOpenMenu: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { theme, setTheme } = useTheme();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Could not update");
      router.refresh();
    });

  const site = data.sites.find((s) => s.id === data.siteId);
  const critical = data.alerts.filter((a) => a.severity === "critical").length;

  return (
    <header
      data-shell
      className={cn(
        "sticky top-0 z-30 flex h-14 items-center gap-1 border-b sm:gap-2 border-border bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-5",
        pending && "cursor-progress",
      )}
    >
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMenu} aria-label="Open navigation">
        <Menu />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 max-w-[150px] min-w-0 gap-2 px-2 sm:max-w-[240px]" aria-label="Switch organization">
            <Building2 className="text-muted-foreground" />
            <span className="truncate text-[13px] font-semibold">{data.org.name}</span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          {data.memberships.map((m) => (
            <DropdownMenuItem key={m.orgId} onSelect={() => m.orgId !== data.org.id && run(() => switchOrganization(m.orgId))}>
              <div className="flex flex-1 flex-col">
                <span className="font-medium">{m.orgName}</span>
                <span className="text-xs text-muted-foreground">{ROLES[m.role].name}</span>
              </div>
              {m.orgId === data.org.id && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="hidden h-8 gap-1.5 sm:inline-flex" aria-label="Filter by plant">
            <MapPin className="text-muted-foreground" />
            <span className="max-w-[160px] truncate">{site ? site.name : "All plants"}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Plant / site</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={data.siteId ?? "all"} onValueChange={(v) => run(() => setSitePreference(v))}>
            <DropdownMenuRadioItem value="all">All plants</DropdownMenuRadioItem>
            {data.sites.map((s) => (
              <DropdownMenuRadioItem key={s.id} value={s.id}>
                {s.name}
                <span className="ml-auto text-xs text-muted-foreground">{s.code}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="hidden h-8 gap-1.5 md:inline-flex" aria-label="Date range">
            <CalendarDays className="text-muted-foreground" />
            {data.range.label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="font-normal text-muted-foreground">
            {formatDate(data.range.from)} – {formatDate(data.range.to)}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {RANGE_PRESETS.map((p) => (
            <DropdownMenuItem key={p.key} onSelect={() => run(() => setRangePreference(p.key))}>
              <span className="flex-1">{p.label}</span>
              {p.key === data.range.key && <Check className="size-4 stroke-[3]" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-1" />

      <Button variant="outline" size="sm" onClick={onOpenSearch} className="h-8 shrink-0 gap-2 text-muted-foreground md:w-64 md:justify-start" aria-label="Search (Ctrl+K)">
        <Search />
        <span className="hidden md:inline">Search records…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[10px] md:inline">Ctrl K</kbd>
      </Button>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="relative" aria-label={`Alerts (${data.alerts.length})`}>
            <Bell />
            {data.alerts.length > 0 && (
              <span className={cn("absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white", critical > 0 ? "bg-[var(--status-critical)]" : "bg-primary")}>
                {data.alerts.length > 99 ? "99+" : data.alerts.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[360px] p-0">
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <div className="text-sm font-semibold">Alerts</div>
            <Link href="/dashboard?view=warehouse" className="text-xs text-primary hover:underline">
              Open alerts view
            </Link>
          </div>
          <ul className="max-h-[360px] divide-y overflow-y-auto">
            {data.alerts.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No active alerts</li>}
            {data.alerts.slice(0, 25).map((a, i) => (
              <li key={i}>
                <Link href={a.href} className="flex gap-2.5 px-3 py-2.5 hover:bg-muted">
                  <span
                    className="mt-1.5 size-2 shrink-0 rounded-full"
                    style={{ background: `var(--status-${a.severity === "critical" ? "critical" : a.severity === "serious" ? "serious" : "warning"})` }}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{a.title}</span>
                    <span className="block text-xs text-muted-foreground">{a.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="hidden sm:inline-flex" aria-label="Theme">
            {theme === "dark" ? <Moon /> : theme === "light" ? <Sun /> : <Monitor />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
            <DropdownMenuRadioItem value="light">
              <Sun /> Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon /> Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <Monitor /> System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="User menu">
            {initials(data.user.name)}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>
            <div className="font-medium">{data.user.name}</div>
            <div className="text-xs font-normal text-muted-foreground">{data.user.email}</div>
            <div className="mt-1 text-xs font-normal text-muted-foreground">
              {data.user.roleName}
              {data.user.title ? ` · ${data.user.title}` : ""}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings">Settings</Link>
          </DropdownMenuItem>
          <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme} className="sm:hidden">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {data.authMode === "demo" && (
            <DropdownMenuItem asChild>
              <Link href="/login">
                <UserRoundCog /> Switch demo persona
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => startTransition(() => signOut())}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
