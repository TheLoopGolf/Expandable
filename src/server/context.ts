import { todayInTz, type IsoDate } from "@/lib/dates";
import { roleHas, ROLES, type Permission, type RoleKey } from "@/lib/permissions";
import { ForbiddenError } from "./errors";

/**
 * Everything a service call needs to know about the caller. Built server-side from the
 * verified session; never from client input.
 */
export interface ServiceContext {
  orgId: string;
  orgName: string;
  userId: string;
  userName: string;
  role: RoleKey;
  timezone: string;
  /** Clock: real time in the app, simulated time in the seed and tests. */
  now: () => Date;
  /** Set by the demo seed so generated history is labeled as such. */
  seed?: boolean;
}

export function can(ctx: Pick<ServiceContext, "role">, permission: Permission): boolean {
  return roleHas(ctx.role, permission);
}

export function authorize(ctx: ServiceContext, permission: Permission): void {
  if (!can(ctx, permission)) {
    throw new ForbiddenError(
      `Your role (${ROLES[ctx.role].name}) is not allowed to ${describe(permission)}.`,
    );
  }
}

function describe(permission: Permission): string {
  const map: Partial<Record<Permission, string>> = {
    "inventory.transact": "post inventory transactions",
    "items.manage": "edit the item master",
    "purchasing.manage": "create or edit purchase orders",
    "purchasing.approve": "approve purchase orders",
    "purchasing.receive": "receive purchase orders",
    "production.manage": "manage work orders",
    "production.execute": "issue materials or record production",
    "sales.manage": "manage sales orders",
    "sales.ship": "reserve or ship sales orders",
    "quality.manage": "manage quality records",
    "quality.hold": "place or release quality holds",
    "engineering.manage": "edit BOMs or engineering changes",
    "engineering.release": "release BOMs or implement engineering changes",
    "planning.run": "run MRP",
    "planning.approve": "approve MRP suggestions",
    "finance.manage": "manage invoices and payments",
    "admin.manage": "administer the organization",
  };
  return map[permission] ?? `perform "${permission}"`;
}

export function today(ctx: Pick<ServiceContext, "timezone" | "now">): IsoDate {
  return todayInTz(ctx.timezone, ctx.now());
}
