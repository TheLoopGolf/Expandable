import type { Permission } from "./permissions";

export interface NavItem {
  title: string;
  href: string;
  icon: string;
  permission: Permission;
  /** Additional path prefixes that should mark this item active. */
  match?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: "gauge", permission: "dashboard.view" },
      { title: "Inventory", href: "/inventory", icon: "boxes", permission: "inventory.view" },
      { title: "Production", href: "/production", icon: "factory", permission: "production.view" },
      { title: "MRP planning", href: "/planning/mrp", icon: "calendar-range", permission: "production.view", match: ["/planning"] },
      { title: "Quality", href: "/quality", icon: "shield-check", permission: "quality.view" },
    ],
  },
  {
    label: "Engineering",
    items: [
      { title: "Engineering", href: "/engineering", icon: "drafting-compass", permission: "engineering.view", match: ["/engineering/changes"] },
      { title: "Bills of materials", href: "/engineering/boms", icon: "network", permission: "engineering.view" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { title: "Sales orders", href: "/sales/orders", icon: "shopping-cart", permission: "sales.view" },
      { title: "Customers", href: "/sales/customers", icon: "building-2", permission: "sales.view" },
      { title: "Purchasing", href: "/purchasing", icon: "truck", permission: "purchasing.view", match: ["/purchasing/orders"] },
      { title: "Suppliers", href: "/purchasing/suppliers", icon: "handshake", permission: "purchasing.view" },
    ],
  },
  {
    label: "Finance",
    items: [{ title: "Finance", href: "/finance", icon: "landmark", permission: "finance.view" }],
  },
  {
    label: "Reporting",
    items: [{ title: "Reports", href: "/reports", icon: "chart-column", permission: "reports.view" }],
  },
  {
    label: "Administration",
    items: [{ title: "Settings", href: "/settings", icon: "settings", permission: "dashboard.view" }],
  },
];

export function isActive(pathname: string, item: NavItem): boolean {
  const candidates = [item.href, ...(item.match ?? [])];
  // Exact section match wins over a shorter prefix (e.g. /purchasing vs /purchasing/suppliers).
  if (pathname === item.href) return true;
  return candidates.some((c) => pathname.startsWith(c + "/") || pathname === c) && !moreSpecificExists(pathname, item);
}

function moreSpecificExists(pathname: string, item: NavItem): boolean {
  return NAV.flatMap((g) => g.items).some(
    (other) => other !== item && other.href.startsWith(item.href + "/") && (pathname === other.href || pathname.startsWith(other.href + "/")),
  );
}
