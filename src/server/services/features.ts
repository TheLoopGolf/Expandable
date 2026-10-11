import type { Sql } from "../db";
import type { ServiceContext } from "../context";

/** Organization-level switches, stored in organizations.settings.features and enforced by the services. */
export const FEATURE_FLAGS = {
  requireIncomingInspection: "Receive lot-tracked purchases into quarantine until released by quality",
  autoInvoiceOnShipment: "Draft an invoice automatically when a shipment is confirmed",
  allowPartialShipments: "Allow shipping part of a sales order line's open quantity",
  mrpIncludeDraftSupply: "Count draft purchase and work orders (and draft work-order demand) in MRP",
} as const;
export type FeatureFlag = keyof typeof FEATURE_FLAGS;
export type Features = Record<FeatureFlag, boolean>;

export const DEFAULT_FEATURES: Features = {
  requireIncomingInspection: false,
  autoInvoiceOnShipment: false,
  allowPartialShipments: true,
  mrpIncludeDraftSupply: true,
};

export function resolveFeatures(stored: unknown): Features {
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_FEATURES };
  for (const k of Object.keys(DEFAULT_FEATURES) as FeatureFlag[]) if (typeof s[k] === "boolean") out[k] = s[k] as boolean;
  return out;
}

export async function orgFeatures(tx: Sql, ctx: ServiceContext): Promise<Features> {
  const [row] = await tx.query<{ features: unknown }>(`select settings -> 'features' as features from organizations where id = $1`, [ctx.orgId]);
  return resolveFeatures(row?.features);
}
