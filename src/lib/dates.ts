/**
 * Business-date helpers. Business dates are ISO 'YYYY-MM-DD' strings interpreted in the
 * organization's timezone; arithmetic is done on UTC midnight to avoid DST drift.
 */
export type IsoDate = string;

const DAY_MS = 86_400_000;

export function todayInTz(timeZone: string, now: Date = new Date()): IsoDate {
  return dateInTz(now, timeZone);
}

export function dateInTz(instant: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function parseIsoDate(d: IsoDate): Date {
  return new Date(`${d}T00:00:00Z`);
}

export function formatIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, days: number): IsoDate {
  return formatIsoDate(new Date(parseIsoDate(d).getTime() + days * DAY_MS));
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((parseIsoDate(a).getTime() - parseIsoDate(b).getTime()) / DAY_MS);
}

export function startOfMonth(d: IsoDate): IsoDate {
  return `${d.slice(0, 7)}-01`;
}

export function addMonths(d: IsoDate, months: number): IsoDate {
  const date = parseIsoDate(d);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return formatIsoDate(target);
}

/** Monday-based week start. */
export function startOfWeek(d: IsoDate): IsoDate {
  const dow = (parseIsoDate(d).getUTCDay() + 6) % 7;
  return addDays(d, -dow);
}

export function startOfQuarter(d: IsoDate): IsoDate {
  const m = Number(d.slice(5, 7));
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${d.slice(0, 4)}-${String(qm).padStart(2, "0")}-01`;
}

export function startOfYear(d: IsoDate): IsoDate {
  return `${d.slice(0, 4)}-01-01`;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b;
}

/** Midday in the given timezone on a business date, as an instant (used by the seed clock). */
export function instantOn(d: IsoDate, hour = 12, minute = 0): Date {
  return new Date(`${d}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
}

export const RANGE_PRESETS = [
  { key: "mtd", label: "Month to date" },
  { key: "qtd", label: "Quarter to date" },
  { key: "ytd", label: "Year to date" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "180d", label: "Last 180 days" },
  { key: "12m", label: "Last 12 months" },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"];

export interface DateRange {
  key: RangeKey;
  label: string;
  from: IsoDate;
  to: IsoDate;
  /** Previous period of equal length, for comparisons. */
  prevFrom: IsoDate;
  prevTo: IsoDate;
  days: number;
}

export function isRangeKey(v: unknown): v is RangeKey {
  return RANGE_PRESETS.some((p) => p.key === v);
}

export function resolveRange(key: RangeKey, today: IsoDate): DateRange {
  let from: IsoDate;
  switch (key) {
    case "mtd":
      from = startOfMonth(today);
      break;
    case "qtd":
      from = startOfQuarter(today);
      break;
    case "ytd":
      from = startOfYear(today);
      break;
    case "30d":
      from = addDays(today, -29);
      break;
    case "90d":
      from = addDays(today, -89);
      break;
    case "180d":
      from = addDays(today, -179);
      break;
    case "12m":
      from = addDays(addMonths(today, -12), 1);
      break;
  }
  const days = diffDays(today, from) + 1;
  let prevFrom: IsoDate;
  let prevTo: IsoDate;
  if (key === "mtd" || key === "qtd" || key === "ytd") {
    const months = key === "mtd" ? 1 : key === "qtd" ? 3 : 12;
    prevFrom = addMonths(from, -months);
    prevTo = addMonths(today, -months);
  } else {
    prevTo = addDays(from, -1);
    prevFrom = addDays(prevTo, -(days - 1));
  }
  const label = RANGE_PRESETS.find((p) => p.key === key)!.label;
  return { key, label, from, to: today, prevFrom, prevTo, days };
}
