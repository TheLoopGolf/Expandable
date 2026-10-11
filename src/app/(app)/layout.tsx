import { AppShell } from "@/components/shell/app-shell";
import type { ShellData } from "@/components/shell/types";
import { requireUser } from "@/server/auth/current";
import { getDb } from "@/server/db";
import { config } from "@/server/config";
import { getShellAlerts } from "@/server/queries/alerts";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = await getDb();
  const alerts = await getShellAlerts(db, user.ctx, { range: user.range, today: user.today, siteId: user.siteId, family: null }, (p) =>
    user.permissions.includes(p as never),
  );
  const data: ShellData = {
    user: user.user,
    org: { id: user.org.id, name: user.org.name, isDemo: user.org.isDemo, seededFor: user.org.seededFor, timezone: user.org.timezone },
    memberships: user.memberships,
    sites: user.sites,
    siteId: user.siteId,
    range: { key: user.range.key, label: user.range.label, from: user.range.from, to: user.range.to },
    today: user.today,
    permissions: user.permissions,
    alerts,
    authMode: config.authMode,
    demoDatabase: config.isDemoDatabase,
  };
  return <AppShell data={data}>{children}</AppShell>;
}
