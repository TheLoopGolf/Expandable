import { createHash } from "node:crypto";
import type { Sql } from "../db";
import type { ServiceContext } from "../context";
import { ConflictError } from "../errors";

/**
 * Run `fn` at most once per (organization, key). A retried request with the same key and
 * the same payload returns the stored result instead of posting again; reusing a key for a
 * different payload is rejected. Runs inside the caller's transaction, so a failed attempt
 * leaves no key behind.
 */
export async function withIdempotency<T extends object>(
  tx: Sql,
  ctx: ServiceContext,
  key: string | undefined | null,
  operation: string,
  request: unknown,
  fn: () => Promise<T>,
): Promise<T & { replayed?: boolean }> {
  if (!key) return (await fn()) as T & { replayed?: boolean };
  const hash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
  const inserted = await tx.query(
    `insert into idempotency_keys (organization_id, key, operation, request_hash, response)
     values ($1, $2, $3, $4, '{}'::jsonb)
     on conflict (organization_id, key) do nothing
     returning key`,
    [ctx.orgId, key, operation, hash],
  );
  if (inserted.length === 0) {
    const [existing] = await tx.query<{ operation: string; request_hash: string; response: T }>(
      `select operation, request_hash, response from idempotency_keys
       where organization_id = $1 and key = $2`,
      [ctx.orgId, key],
    );
    if (!existing || existing.operation !== operation || existing.request_hash !== hash) {
      throw new ConflictError("This request key was already used for a different transaction.");
    }
    return { ...(existing.response as T), replayed: true };
  }
  const result = await fn();
  await tx.query(
    `update idempotency_keys set response = $3::jsonb where organization_id = $1 and key = $2`,
    [ctx.orgId, key, JSON.stringify(result)],
  );
  return result as T & { replayed?: boolean };
}
