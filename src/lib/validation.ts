import { z } from "zod";
import { ROLE_KEYS } from "./permissions";

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

export const purchaseOrderInput = z.object({
  supplierId: uuid,
  warehouseId: uuid,
  orderDate: isoDate.optional(),
  expectedDate: isoDate,
  notes: optionalText,
  source: z.enum(["manual", "mrp"]).default("manual"),
  submitForApproval: z.boolean().optional(),
  lines: z
    .array(
      z.object({
        itemId: uuid,
        quantity: positiveQty,
        unitCost: money,
        expectedDate: isoDate.optional(),
      }),
    )
    .min(1, "Add at least one line"),
});

export const receiveInput = z.object({
  purchaseOrderId: uuid,
  idempotencyKey: z.string().trim().min(8).max(100),
  lines: z
    .array(
      z.object({
        lineId: uuid,
        quantity: positiveQty,
        lotNumber: optionalText,
        expiresOn: isoDate.optional().nullable(),
        binId: uuid.optional().nullable(),
        quarantine: z.boolean().optional(),
      }),
    )
    .min(1, "Enter a quantity for at least one line"),
});

export const supplierInput = z.object({
  code: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(120),
  contactName: optionalText,
  email: z.string().trim().email().optional().or(z.literal("")).transform((v) => v || undefined),
  phone: optionalText,
  paymentTermsDays: z.coerce.number().int().min(0).max(180).default(30),
  defaultLeadTimeDays: z.coerce.number().int().min(0).max(365).default(14),
});

export const customerInput = z.object({
  code: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(120),
  contactName: optionalText,
  email: z.string().trim().email().optional().or(z.literal("")).transform((v) => v || undefined),
  phone: optionalText,
  segment: optionalText,
  paymentTermsDays: z.coerce.number().int().min(0).max(180).default(30),
  creditLimit: money.optional().nullable(),
  shipTo: optionalText,
});

export const salesOrderInput = z.object({
  customerId: uuid,
  warehouseId: uuid,
  orderDate: isoDate.optional(),
  requestedDate: isoDate.optional().nullable(),
  promisedDate: isoDate,
  customerPo: optionalText,
  notes: optionalText,
  confirm: z.boolean().optional(),
  lines: z
    .array(z.object({ itemId: uuid, quantity: positiveQty, unitPrice: money.optional(), promisedDate: isoDate.optional() }))
    .min(1, "Add at least one line"),
});

export const shipInput = z.object({
  salesOrderId: uuid,
  idempotencyKey: z.string().trim().min(8).max(100),
  carrier: optionalText,
  trackingNumber: optionalText,
  createInvoice: z.boolean().optional(),
  lines: z.array(z.object({ lineId: uuid, quantity: positiveQty })).min(1, "Enter a quantity for at least one line"),
});

export const workOrderInput = z.object({
  itemId: uuid,
  quantity: positiveQty,
  plannedStart: isoDate,
  dueDate: isoDate,
  warehouseId: uuid.optional().nullable(),
  materialWarehouseId: uuid.optional().nullable(),
  workCenterId: uuid.optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  salesOrderLineId: uuid.optional().nullable(),
  notes: optionalText,
  source: z.enum(["manual", "mrp"]).default("manual"),
  release: z.boolean().optional(),
});

export const issueInput = z.object({
  workOrderId: uuid,
  idempotencyKey: z.string().trim().min(8).max(100),
  lines: z
    .array(z.object({ materialId: uuid, quantity: positiveQty, lotId: uuid.optional().nullable() }))
    .min(1, "Enter at least one quantity to issue"),
});

export const productionInput = z.object({
  workOrderId: uuid,
  quantityGood: qty,
  quantityScrap: qty.default("0"),
  lotNumber: optionalText,
  binId: uuid.optional().nullable(),
  notes: optionalText,
  idempotencyKey: z.string().trim().min(8).max(100),
});

export const itemInput = z.object({
  sku: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dot, dash or underscore"),
  name: z.string().trim().min(2).max(120),
  description: optionalText,
  itemType: z.enum(["purchased", "manufactured"]),
  category: z.string().trim().min(2).max(60),
  productFamily: optionalText,
  uom: z.string().trim().min(1).max(10).default("ea"),
  standardCost: money,
  listPrice: money.optional().nullable(),
  preferredSupplierId: uuid.optional().nullable(),
  leadTimeDays: z.coerce.number().int().min(0).max(365),
  reorderPoint: qty,
  safetyStock: qty,
  minOrderQty: positiveQty,
  tracking: z.enum(["none", "lot", "serial"]),
  shelfLifeDays: z.coerce.number().int().positive().max(3650).optional().nullable(),
  defaultWarehouseId: uuid.optional().nullable(),
  lifecycleStatus: z.enum(["draft", "active", "hold", "obsolete"]).default("active"),
});

export const miscReceiptInput = z.object({
  itemId: uuid,
  warehouseId: uuid,
  binId: uuid.optional().nullable(),
  quantity: positiveQty,
  lotNumber: optionalText,
  expiresOn: isoDate.optional().nullable(),
  reason: z.string().trim().min(3, "Give a reason").max(200),
  idempotencyKey: optionalText,
  /** Opening balance (credits equity instead of inventory adjustments). Seed/import only. */
  opening: z.boolean().optional(),
});

export const miscIssueInput = z.object({
  itemId: uuid,
  warehouseId: uuid,
  binId: uuid.optional().nullable(),
  lotId: uuid.optional().nullable(),
  quantity: positiveQty,
  reason: z.string().trim().min(3, "Give a reason").max(200),
  idempotencyKey: optionalText,
});

export const transferInput = z.object({
  itemId: uuid,
  fromWarehouseId: uuid,
  fromBinId: uuid.optional().nullable(),
  lotId: uuid.optional().nullable(),
  toWarehouseId: uuid,
  toBinId: uuid.optional().nullable(),
  quantity: positiveQty,
  reason: optionalText,
  idempotencyKey: optionalText,
});

export const countInput = z.object({
  itemId: uuid,
  warehouseId: uuid,
  binId: uuid.optional().nullable(),
  lotId: uuid.optional().nullable(),
  countedQuantity: qty,
  reason: z.string().trim().min(3, "Give a reason").max(200),
  idempotencyKey: optionalText,
});

export const qualityEventInput = z.object({
  eventType: z.enum(["ncr", "complaint", "deviation", "audit_finding"]).default("ncr"),
  title: z.string().trim().min(4).max(160),
  description: optionalText,
  severity: z.enum(["low", "medium", "high", "critical"]),
  source: z.enum(["incoming", "in_process", "final", "customer", "internal"]).default("internal"),
  itemId: uuid.optional().nullable(),
  lotId: uuid.optional().nullable(),
  workOrderId: uuid.optional().nullable(),
  purchaseOrderId: uuid.optional().nullable(),
  salesOrderId: uuid.optional().nullable(),
  supplierId: uuid.optional().nullable(),
  customerId: uuid.optional().nullable(),
  quantityAffected: qty.optional().nullable(),
  ownerId: uuid.optional().nullable(),
  dueDate: isoDate.optional().nullable(),
  placeHold: z.boolean().optional(),
  holdReason: optionalText,
});

export const holdInput = z.object({
  lotId: uuid,
  reason: z.string().trim().min(5, "Document the reason (at least 5 characters)").max(500),
  qualityEventId: uuid.optional().nullable(),
});

export const releaseHoldInput = z.object({
  holdId: uuid,
  reason: z.string().trim().min(10, "Document the release justification (at least 10 characters)").max(1000),
});

export const updateEventInput = z.object({
  id: uuid,
  status: z.enum(["open", "investigating", "pending_disposition", "closed", "canceled"]),
  disposition: z.enum(["use_as_is", "rework", "scrap", "return_to_supplier"]).optional().nullable(),
  rootCause: optionalText,
  closureNotes: optionalText,
});

export const capaInput = z.object({
  qualityEventId: uuid.optional().nullable(),
  actionType: z.enum(["corrective", "preventive"]),
  description: z.string().trim().min(5).max(1000),
  ownerId: uuid.optional().nullable(),
  dueDate: isoDate,
});

export const inspectionInput = z.object({
  inspectionType: z.enum(["incoming", "in_process", "final"]),
  itemId: uuid,
  lotId: uuid.optional().nullable(),
  purchaseOrderId: uuid.optional().nullable(),
  workOrderId: uuid.optional().nullable(),
  quantityInspected: qty.refine((v) => Number(v) > 0, "Must be greater than zero"),
  quantityRejected: qty.default("0"),
  result: z.enum(["pass", "fail"]),
  notes: optionalText,
  openNcr: z.boolean().optional(),
});

export const bomLinesInput = z
  .array(
    z.object({
      componentItemId: uuid,
      quantityPer: positiveQty,
      scrapPct: qty.default("0").refine((v) => Number(v) < 100, "Scrap must be below 100%"),
      reference: optionalText,
    }),
  )
  .min(1, "Add at least one component");

export const bomInput = z.object({
  itemId: uuid,
  revision: z.string().trim().min(1).max(10),
  effectiveFrom: isoDate.optional().nullable(),
  notes: optionalText,
  lines: bomLinesInput,
});

export const ecoInput = z.object({
  itemId: uuid,
  title: z.string().trim().min(5).max(160),
  description: optionalText,
  reason: optionalText,
  toRevision: z.string().trim().min(1).max(10),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

export const mrpRunInput = z.object({
  horizonDays: z.coerce.number().int().min(7).max(365).default(90),
  siteId: uuid.optional().nullable(),
});

export const orgSettingsInput = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(3).max(60),
  features: z.record(z.string(), z.boolean()).default({}),
});

export const memberInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(120),
  title: z.string().trim().max(80).optional(),
  role: z.enum(ROLE_KEYS),
});

