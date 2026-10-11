export type Row = Record<string, unknown>;

/** Minimal query surface shared by the PGlite and postgres.js adapters. */
export interface Sql {
  /** Run one parameterized statement ($1, $2 …) and return its rows. */
  query<T = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface Database extends Sql {
  readonly kind: "pglite" | "postgres";
  /** Run several statements without parameters (migrations). */
  exec(text: string): Promise<void>;
  /** Run `fn` inside a single database transaction (rolled back if it throws). */
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** First row or null. */
export async function maybeOne<T = Row>(
  db: Sql,
  text: string,
  params?: readonly unknown[],
): Promise<T | null> {
  const rows = await db.query<T>(text, params);
  return rows[0] ?? null;
}

/** Exactly one row; throws when missing. */
export async function one<T = Row>(db: Sql, text: string, params?: readonly unknown[]): Promise<T> {
  const row = await maybeOne<T>(db, text, params);
  if (!row) throw new Error("Expected one row, got none");
  return row;
}

/**
 * Encode a list as a Postgres array literal so it can be bound as a single text
 * parameter and cast (`$1::uuid[]`). Works identically in both drivers.
 */
export function pgArray(values: readonly (string | number)[]): string {
  return `{${values.map((v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
}
