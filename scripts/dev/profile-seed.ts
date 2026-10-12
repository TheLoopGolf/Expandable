import { createPgliteDatabase } from "../../src/server/db/pglite";
import { migrate } from "../../src/server/db/migrate";
import { seedDemo } from "../../src/server/seed";
import type { Database, Sql } from "../../src/server/db";

const stats = new Map<string, { n: number; ms: number }>();
function wrap(q: Sql): Sql {
  return {
    async query(text, params) {
      const t = performance.now();
      try { return await q.query(text, params); } finally {
        const key = text.replace(/\s+/g, " ").slice(0, 110);
        const s = stats.get(key) ?? { n: 0, ms: 0 };
        s.n++; s.ms += performance.now() - t; stats.set(key, s);
      }
    },
  };
}
async function main() {
  const raw = await createPgliteDatabase("memory://");
  await migrate(raw);
  const db: Database = { ...raw, ...wrap(raw), transaction: (fn) => raw.transaction((tx) => fn({ ...tx, ...wrap(tx) })) };
  await seedDemo(db, { days: Number(process.env.DAYS ?? 60), skipSecondTenant: true });
  const top = [...stats].sort((a, b) => b[1].ms - a[1].ms).slice(0, 25);
  for (const [k, v] of top) console.log(`${Math.round(v.ms).toString().padStart(6)}ms ${String(v.n).padStart(6)}x  ${k}`);
  console.log("total queries", [...stats.values()].reduce((a, b) => a + b.n, 0));
}
main();
