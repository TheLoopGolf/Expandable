"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDate } from "@/lib/format";
import { DesktopSidebar, SidebarNav } from "./sidebar";
import { TopBar } from "./topbar";
import { CommandMenu } from "./command-menu";
import { Logo } from "./logo";
import type { ShellData } from "./types";

const COLLAPSE_KEY = "forgeflow.sidebar.collapsed";
const COLLAPSE_EVENT = "forgeflow:sidebar";

// Sidebar preference lives in localStorage; read it as an external store so the server render
// (always expanded) and the client never disagree during hydration.
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function subscribeCollapsed(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(COLLAPSE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(COLLAPSE_EVENT, onChange);
  };
}

export function AppShell({ data, children }: { data: ShellData; children: React.ReactNode }) {
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const toggle = useCallback(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, readCollapsed() ? "0" : "1");
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  }, []);

  const demoFooter = data.org.isDemo ? (
    <div className="mx-2.5 mb-2 rounded-md border border-dashed border-border bg-muted/50 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
      <span className="font-semibold text-foreground">Demo workspace</span> · fictional sample data
      {data.org.seededFor ? ` through ${formatDate(data.org.seededFor)}` : ""}, not live telemetry.
      {data.permissions.includes("admin.manage") && (
        <>
          {" "}
          <Link href="/settings?tab=data" className="underline">
            Reset
          </Link>
        </>
      )}
    </div>
  ) : null;

  return (
    <div className="flex min-h-svh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>
      <DesktopSidebar permissions={data.permissions} collapsed={collapsed} onToggle={toggle} footer={demoFooter} />
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[272px] p-0">
          <SheetHeader className="h-14 justify-center border-b px-3.5">
            <SheetTitle asChild>
              <div>
                <Logo />
              </div>
            </SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto">
            <SidebarNav permissions={data.permissions} onNavigate={() => setMobileOpen(false)} />
          </div>
          {demoFooter}
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar data={data} onOpenSearch={() => setSearchOpen(true)} onOpenMenu={() => setMobileOpen(true)} />
        <main id="main" className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-5 md:px-6 md:py-6">
          {children}
        </main>
      </div>
      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} permissions={data.permissions} />
    </div>
  );
}
