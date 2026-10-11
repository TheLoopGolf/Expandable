/**
 * Exact fixed-point arithmetic for quantities and money.
 * Values are bigint scaled by 10^4 (four decimal places, matching numeric(14,4)).
 * Never use JavaScript floating point for posting logic.
 */
export type Dec = bigint;

const SCALE = 4;
const FACTOR = 10_000n;

function roundDiv(n: bigint, d: bigint): bigint {
  // round half away from zero
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return neg ? -q : q;
}

export function dec(value: string | number | bigint | null | undefined): Dec {
  if (value === null || value === undefined || value === "") return 0n;
  if (typeof value === "bigint") return value * FACTOR;
  let s = typeof value === "number" ? value.toFixed(8) : value.trim();
  if (!/^[-+]?\d*(\.\d*)?$/.test(s) || s === "" || s === "." || s === "-" || s === "+") {
    throw new Error(`Invalid decimal: ${String(value)}`);
  }
  const negative = s.startsWith("-");
  if (negative || s.startsWith("+")) s = s.slice(1);
  const [intPart = "0", fracRaw = ""] = s.split(".");
  const frac = (fracRaw + "0".repeat(SCALE + 1)).slice(0, SCALE + 1);
  let scaled = BigInt(intPart || "0") * FACTOR + BigInt(frac.slice(0, SCALE));
  if (Number(frac[SCALE]) >= 5) scaled += 1n;
  return negative ? -scaled : scaled;
}

export const ZERO: Dec = 0n;
export const add = (...v: Dec[]): Dec => v.reduce((a, b) => a + b, 0n);
export const sub = (a: Dec, b: Dec): Dec => a - b;
export const mul = (a: Dec, b: Dec): Dec => roundDiv(a * b, FACTOR);
export const div = (a: Dec, b: Dec): Dec => {
  if (b === 0n) throw new Error("Division by zero");
  return roundDiv(a * FACTOR, b);
};
export const neg = (a: Dec): Dec => -a;
export const abs = (a: Dec): Dec => (a < 0n ? -a : a);
export const cmp = (a: Dec, b: Dec): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);
export const max = (a: Dec, b: Dec): Dec => (a > b ? a : b);
export const min = (a: Dec, b: Dec): Dec => (a < b ? a : b);
export const isZero = (a: Dec) => a === 0n;
export const isPositive = (a: Dec) => a > 0n;
export const isNegative = (a: Dec) => a < 0n;
export const sum = (values: Dec[]) => values.reduce((a, b) => a + b, 0n);

/** Round up to a whole unit (used for planned order quantities). */
export function ceilUnit(a: Dec): Dec {
  if (a % FACTOR === 0n) return a;
  return a > 0n ? (a / FACTOR + 1n) * FACTOR : (a / FACTOR) * FACTOR;
}

/** Round to `dp` decimal places (dp <= 4). */
export function round(a: Dec, dp = 2): Dec {
  const f = 10n ** BigInt(SCALE - dp);
  return roundDiv(a, f) * f;
}

/** Plain decimal string suitable for SQL numeric parameters. */
export function toStr(a: Dec, dp = SCALE): string {
  const r = round(a, dp);
  const negative = r < 0n;
  const absV = negative ? -r : r;
  const int = absV / FACTOR;
  const frac = (absV % FACTOR).toString().padStart(SCALE, "0").slice(0, dp);
  return `${negative ? "-" : ""}${int}${dp > 0 ? "." + frac : ""}`;
}

/** Display/charting only — never feed back into posting logic. */
export function toNumber(a: Dec): number {
  return Number(toStr(a));
}

/** Convenience for SQL numeric strings coming back from the driver. */
export function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}
