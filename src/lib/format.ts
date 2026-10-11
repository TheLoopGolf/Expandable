/** Display formatting (client and server safe). Never feed formatted values back into logic. */
const currency0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const currency2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  return typeof v === "number" ? v : Number(v);
}

export function formatCurrency(v: string | number | null | undefined, opts: { cents?: boolean; compact?: boolean } = {}) {
  const n = toNum(v);
  if (opts.compact && Math.abs(n) >= 10_000) return compactCurrency.format(n);
  return (opts.cents ? currency2 : currency0).format(n);
}

export function formatNumber(v: string | number | null | undefined, maxFraction = 2) {
  const n = toNum(v);
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFraction });
}

export function formatCompact(v: number) {
  return Math.abs(v) >= 1000 ? compactNumber.format(v) : formatNumber(v, 0);
}

export function formatPercent(v: number | null | undefined, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

/** 'YYYY-MM-DD' business date → "Oct 11, 2026" (no timezone shift). */
export function formatDate(d: string | null | undefined, opts: { year?: boolean } = { year: true }) {
  if (!d) return "—";
  const date = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: opts.year === false ? undefined : "numeric", timeZone: "UTC" });
}

export function formatDateTime(iso: string | Date | null | undefined, timeZone?: string) {
  if (!iso) return "—";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
}

export function formatRelative(iso: string | Date, now: Date = new Date()) {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const diff = (now.getTime() - date.getTime()) / 1000;
  if (diff < 0) return "just now";
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatQty(v: string | number | null | undefined, uom?: string) {
  const s = formatNumber(v, 4);
  return uom && uom !== "ea" ? `${s} ${uom}` : s;
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}
