import type { Permission, RoleKey } from "@/lib/permissions";
import type { RangeKey } from "@/lib/dates";

export interface ShellData {
  user: { id: string; name: string; email: string; title: string | null; role: RoleKey; roleName: string };
  org: { id: string; name: string; isDemo: boolean; seededFor: string | null; timezone: string };
  memberships: { orgId: string; orgName: string; role: RoleKey }[];
  sites: { id: string; code: string; name: string }[];
  siteId: string | null;
  range: { key: RangeKey; label: string; from: string; to: string };
  today: string;
  permissions: Permission[];
  alerts: { title: string; detail: string; href: string; severity: "critical" | "serious" | "warning" }[];
  authMode: "demo" | "supabase";
  demoDatabase: boolean;
}
