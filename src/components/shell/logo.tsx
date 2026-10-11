import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Original ForgeFlow mark: an anvil-like base with a flowing arc. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M8 21.5h16l-2.2 3H10.2z" fill="white" opacity="0.95" />
      <path d="M9 18.5c2.5-6.5 9.5-9.8 15-8.2-4.6.4-8.7 3.3-10.6 8.2z" fill="white" />
      <circle cx="23.2" cy="9.4" r="1.6" fill="white" opacity="0.8" />
    </svg>
  );
}

export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      {!collapsed && (
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">{BRAND.name}</div>
          <div className="text-[11px] text-muted-foreground">ERP</div>
        </div>
      )}
    </div>
  );
}
