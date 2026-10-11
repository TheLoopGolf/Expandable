/**
 * Permission map — the single source of truth for role capabilities.
 * Enforced server-side in every service call (`authorize`), mirrored to the `roles`
 * table by the seed for display. UI hiding is only a convenience.
 */
export const PERMISSIONS = {
  "dashboard.view": "View dashboards",
  "inventory.view": "View items, stock, lots and ledger",
  "inventory.transact": "Post stock receipts, issues, transfers and counts",
  "items.manage": "Create and edit items",
  "engineering.view": "View BOMs and engineering changes",
  "engineering.manage": "Edit draft BOMs and ECOs",
  "engineering.release": "Release BOMs and implement ECOs",
  "production.view": "View work orders and schedules",
  "production.manage": "Create, release, hold and close work orders",
  "production.execute": "Issue materials and record production",
  "planning.run": "Run MRP",
  "planning.approve": "Approve or dismiss MRP suggestions",
  "sales.view": "View customers and sales orders",
  "sales.manage": "Create and edit customers and sales orders",
  "sales.ship": "Reserve stock and confirm shipments",
  "purchasing.view": "View suppliers and purchase orders",
  "purchasing.manage": "Create and edit purchase orders",
  "purchasing.approve": "Approve and cancel purchase orders",
  "purchasing.receive": "Receive against purchase orders",
  "quality.view": "View quality events, holds and CAPA",
  "quality.manage": "Open NCRs, record inspections, manage CAPA",
  "quality.hold": "Place and release quality holds",
  "finance.view": "View invoices, AR/AP and journals",
  "finance.manage": "Issue invoices and record payments",
  "reports.view": "View and export reports",
  "audit.view": "View the audit trail",
  "admin.manage": "Manage organization settings, members and demo data",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_KEYS = [
  "admin",
  "manager",
  "planner",
  "warehouse",
  "sales",
  "quality",
  "finance",
  "viewer",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

const VIEW: Permission[] = [
  "dashboard.view",
  "inventory.view",
  "engineering.view",
  "production.view",
  "sales.view",
  "purchasing.view",
  "quality.view",
  "finance.view",
  "reports.view",
];

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ROLES: Record<RoleKey, { name: string; description: string; permissions: Permission[] }> = {
  admin: {
    name: "Admin",
    description: "Full access including organization settings and members.",
    permissions: ALL,
  },
  manager: {
    name: "Manager",
    description: "Operations manager: every operational action, no administration.",
    permissions: ALL.filter((p) => p !== "admin.manage"),
  },
  planner: {
    name: "Production Planner",
    description: "Plans and executes production, runs MRP, raises purchase requests.",
    permissions: [
      ...VIEW,
      "production.manage",
      "production.execute",
      "planning.run",
      "planning.approve",
      "purchasing.manage",
      "engineering.manage",
      "audit.view",
    ],
  },
  warehouse: {
    name: "Warehouse",
    description: "Receives, stores, issues and ships material.",
    permissions: [...VIEW, "inventory.transact", "purchasing.receive", "production.execute", "sales.ship"],
  },
  sales: {
    name: "Sales",
    description: "Manages customers and sales orders, reserves stock.",
    permissions: [...VIEW, "sales.manage", "sales.ship"],
  },
  quality: {
    name: "Quality",
    description: "Inspections, NCRs, CAPA and lot holds/releases.",
    permissions: [...VIEW, "quality.manage", "quality.hold", "audit.view"],
  },
  finance: {
    name: "Finance",
    description: "Invoicing, payments, AR/AP and cost reporting.",
    permissions: [...VIEW, "finance.manage", "audit.view"],
  },
  viewer: {
    name: "Viewer",
    description: "Read-only access to operational data.",
    permissions: VIEW,
  },
};

export function roleHas(role: RoleKey, permission: Permission): boolean {
  return ROLES[role]?.permissions.includes(permission) ?? false;
}

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === "string" && (ROLE_KEYS as readonly string[]).includes(value);
}
