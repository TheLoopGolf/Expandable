import type { Database } from "../db";

/**
 * Seed the demo tenants. The embedded database replays the history through the services
 * directly; a remote PostgreSQL database receives the same history generated in memory and
 * copied in bulk (see snapshot.ts), which takes minutes instead of hours over a network.
 */
export async function seedDatabase(db: Database, log: (m: string) => void = () => {}, opts: { replace?: boolean } = {}): Promise<void> {
  if (db.kind === "postgres") {
    const { seedFromSnapshot } = await import("./snapshot");
    await seedFromSnapshot(db, { log, replace: opts.replace });
  } else {
    if (opts.replace) await truncateAll(db);
    const { seedDemo } = await import("./index");
    await seedDemo(db, { log });
  }
}

/** Seed the demo tenants if the database has no organizations yet. */
export async function ensureSeeded(db: Database): Promise<boolean> {
  const [row] = await db.query<{ n: number }>(`select count(*) as n from organizations`);
  if (Number(row.n) > 0) return false;
  await seedDatabase(db, (m) => console.log(`[forgeflow] ${m}`));
  return true;
}

/** Remove all business data (demo reset). Truncate bypasses the append-only row triggers by design. */
export async function truncateAll(db: Database): Promise<void> {
  const { truncateStatement } = await import("./snapshot");
  await db.exec(await truncateStatement(db));
}
