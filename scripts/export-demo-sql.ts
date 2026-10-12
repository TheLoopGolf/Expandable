/**
 * Export a seeded demo database as numbered SQL files (one statement each, apply in name order).
 *
 * For PostgreSQL targets you can reach directly, `npm run db:seed` already does this in one step.
 * Use the export when the database is only reachable through a SQL console or API. The target
 * needs the migrations applied and no data:
 *
 *   PGLITE_DATA_DIR=.data/export npm run db:reset                         # fresh source database
 *   PGLITE_DATA_DIR=.data/export npx tsx scripts/export-demo-sql.ts out/demo-sql
 *   for f in out/demo-sql/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
 */
import fs from "node:fs";
import path from "node:path";
import { databaseMode, openDatabase } from "../src/server/db";
import { snapshotStatements } from "../src/server/seed/snapshot";

async function main() {
  const outDir = process.argv[2] ?? "out/demo-sql";
  if (databaseMode() !== "pglite") throw new Error("Export reads the PGlite demo database; unset DATABASE_URL.");
  const db = await openDatabase();
  try {
    const { statements, rows } = await snapshotStatements(db, { markMigrations: true });
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    statements.forEach((s, i) => {
      const table = s.match(/^insert into public\.(\w+)/)?.[1] ?? "finalize";
      fs.writeFileSync(path.join(outDir, `${String(i + 1).padStart(4, "0")}_${table}.sql`), `${s};\n`);
    });
    console.log(`[forgeflow] exported ${rows} rows into ${statements.length} files in ${outDir}`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error("[forgeflow] export failed:", err);
  process.exit(1);
});
