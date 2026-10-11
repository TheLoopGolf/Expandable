import { ClipboardX, Factory, PackageCheck, PlayCircle, Plus, ShoppingCart } from "lucide-react";
import type { Permission } from "./permissions";

export const QUICK_ACTIONS = [
  { label: "New sales order", href: "/sales/orders/new", icon: ShoppingCart, permission: "sales.manage" },
  { label: "New purchase order", href: "/purchasing/orders/new", icon: Plus, permission: "purchasing.manage" },
  { label: "Create work order", href: "/production/work-orders/new", icon: Factory, permission: "production.manage" },
  { label: "Receive stock", href: "/purchasing/receive", icon: PackageCheck, permission: "purchasing.receive" },
  { label: "Run MRP", href: "/planning/mrp", icon: PlayCircle, permission: "planning.run" },
  { label: "Open nonconformance", href: "/quality/new", icon: ClipboardX, permission: "quality.manage" },
] as const satisfies readonly { label: string; href: string; icon: unknown; permission: Permission }[];

export const DASHBOARD_VIEWS = [
  { key: "executive", label: "Executive" },
  { key: "planner", label: "Production planner" },
  { key: "warehouse", label: "Warehouse" },
  { key: "quality", label: "Quality" },
] as const;
