import { z } from "zod";

/** Shared Zod building blocks. Quantities/money are normalized to decimal strings. */
const decimalString = (scale: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? String(v) : v.trim()))
    .refine((v) => /^\d+(\.\d+)?$/.test(v), "Enter a valid non-negative number")
    .refine((v) => (v.split(".")[1]?.length ?? 0) <= scale, `At most ${scale} decimal places`)
    .refine((v) => Number(v) < 1e10, "Value is too large");

export const qty = decimalString(4);
export const positiveQty = decimalString(4).refine((v) => Number(v) > 0, "Must be greater than zero");
export const money = decimalString(4);
export const uuid = z.string().uuid("Invalid identifier");
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v ? v : undefined));
