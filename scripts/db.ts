/**
 * Database CLI.
 *   npm run db:migrate   apply SQL migrations (PGlite demo dir or DATABASE_URL)
 *   npm run db:seed      seed demo tenants if the database is empty
 *   npm run db:reset     wipe all business data and re-seed (demo/dev only)
 *   npm run db:setup     migrate + seed if empty (runs automatically before `npm run dev`)
 */
import { openDatabase, databaseMode, pgliteDataDir } from "../src/server/db";
import { migrate } from "../src/server/db/migrate";
import { ensureSeeded, seedDatabase } from "../src/server/seed/ensure";

async function main() {
  const command = process.argv[2] ?? "setup";
  const mode = databaseMode();
  console.log(`[forgeflow] database: ${mode === "pglite" ? `PGlite (${pgliteDataDir()})` : "PostgreSQL (DATABASE_URL)"}`);
  const db = await openDatabase();
  try {
    if (command === "migrate" || command === "setup" || command === "reset" || command === "seed") {
      const ran = await migrate(db);
      console.log(ran.length ? `[forgeflow] applied migrations: ${ran.join(", ")}` : "[forgeflow] migrations up to date");
    }
    if (command === "setup" || command === "seed") {
      const seeded = await ensureSeeded(db);
      if (!seeded) console.log("[forgeflow] data already present; use `npm run db:reset` to regenerate demo data");
    }
    if (command === "reset") {
      if (mode === "postgres" && process.env.ALLOW_DEMO_RESET !== "true") {
        throw new Error("Refusing to wipe a PostgreSQL database. Set ALLOW_DEMO_RESET=true if this is a disposable demo database.");
      }
      await seedDatabase(db, (m) => console.log(`[forgeflow] ${m}`), { replace: true });
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error("[forgeflow] failed:", err);
  process.exit(1);
});
