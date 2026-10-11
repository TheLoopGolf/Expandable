import { createPgliteDatabase } from "./pglite";
import { createPostgresDatabase } from "./postgres";
import { migrate } from "./migrate";
import type { Database } from "./types";

export type { Database, Sql, Row } from "./types";
export { one, maybeOne, pgArray } from "./types";

export function databaseMode(): "postgres" | "pglite" {
  return process.env.DATABASE_URL ? "postgres" : "pglite";
}

export function pgliteDataDir(): string {
  return process.env.PGLITE_DATA_DIR ?? ".data/pglite";
}

/** Open a database connection without migrating or seeding (scripts and tests). */
export async function openDatabase(): Promise<Database> {
  const url = process.env.DATABASE_URL;
  if (url) return createPostgresDatabase(url);
  return createPgliteDatabase(pgliteDataDir());
}

type DbGlobal = typeof globalThis & { __forgeflowDb?: Promise<Database> };
const g = globalThis as DbGlobal;

/**
 * Process-wide database handle used by the web app.
 * In demo (PGlite) mode the database is migrated and seeded on first use if empty,
 * so `npm run dev` works with zero setup. In Postgres/Supabase mode migrations and the
 * seed are explicit commands (`npm run db:migrate`, `npm run db:seed`).
 */
export function getDb(): Promise<Database> {
  if (!g.__forgeflowDb) {
    g.__forgeflowDb = (async () => {
      const db = await openDatabase();
      if (db.kind === "pglite" || process.env.AUTO_MIGRATE === "true") {
        await migrate(db);
        const { ensureSeeded } = await import("../seed/ensure");
        await ensureSeeded(db);
      }
      return db;
    })().catch((err) => {
      g.__forgeflowDb = undefined;
      throw err;
    });
  }
  return g.__forgeflowDb;
}

/** Replace the cached handle (used after a demo reset). */
export function setDb(db: Promise<Database> | undefined) {
  g.__forgeflowDb = db;
}
