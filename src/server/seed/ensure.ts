import type { Database } from "../db";

/** Seed the demo tenants if the database has no organizations yet. */
export async function ensureSeeded(db: Database): Promise<boolean> {
  const [row] = await db.query<{ n: number }>(`select count(*) as n from organizations`);
  if (Number(row.n) > 0) return false;
  const { seedDemo } = await import("./index");
  await seedDemo(db, { log: (m) => console.log(`[forgeflow] ${m}`) });
  return true;
}

/** Remove all business data (demo reset). Truncate bypasses the append-only row triggers by design. */
export async function truncateAll(db: Database): Promise<void> {
  const tables = await db.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' and tablename <> 'roles'`,
  );
  if (tables.length === 0) return;
  await db.exec(`truncate ${tables.map((t) => `public."${t.tablename}"`).join(", ")} restart identity cascade`);
}
