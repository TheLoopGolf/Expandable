import fs from "node:fs";
import path from "node:path";
import type { Database } from "./types";

export const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

// The SQL files ship via outputFileTracingIncludes (next.config.ts), so tracing can skip these reads.
export function listMigrations(dir = MIGRATIONS_DIR): { name: string; sql: string }[] {
  return fs
    .readdirSync(/*turbopackIgnore: true*/ dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, name), "utf8") }));
}

/**
 * Apply pending SQL migrations in order. Each file runs in its own transaction and is
 * recorded in app.schema_migrations. (Supabase CLI users can instead run `supabase db push`,
 * which applies the same files.)
 */
export async function migrate(db: Database, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`
    create schema if not exists app;
    create table if not exists app.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);
  const applied = new Set(
    (await db.query<{ name: string }>("select name from app.schema_migrations")).map((r) => r.name),
  );
  const ran: string[] = [];
  for (const m of listMigrations(dir)) {
    if (applied.has(m.name)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query(`insert into app.schema_migrations (name) values ($1)`, [m.name]);
    });
    ran.push(m.name);
  }
  return ran;
}
