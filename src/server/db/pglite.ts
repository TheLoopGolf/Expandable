import fs from "node:fs";
import path from "node:path";
import { PGlite, types } from "@electric-sql/pglite";
import type { Database, Sql } from "./types";

const parsers = {
  // Business dates stay as 'YYYY-MM-DD' strings to avoid timezone shifts.
  [types.DATE]: (value: string) => value,
  [types.INT8]: (value: string) => Number(value),
};

export async function createPgliteDatabase(dataDir?: string): Promise<Database> {
  const persistent = dataDir && dataDir !== "memory://" ? path.resolve(dataDir) : undefined;
  if (persistent) fs.mkdirSync(path.dirname(persistent), { recursive: true });
  const pg = new PGlite(persistent, {
    parsers,
    relaxedDurability: process.env.PGLITE_RELAXED_DURABILITY === "true",
  });
  await pg.waitReady;
  await pg.exec("set timezone = 'UTC'");

  const wrap = (q: { query: PGlite["query"] }): Sql => ({
    async query<T>(text: string, params?: readonly unknown[]) {
      const result = await q.query<T>(text, params ? [...params] : undefined);
      return result.rows;
    },
  });

  return {
    kind: "pglite",
    ...wrap(pg),
    async exec(text: string) {
      await pg.exec(text);
    },
    transaction<T>(fn: (tx: Sql) => Promise<T>) {
      return pg.transaction((tx) => fn(wrap(tx)));
    },
    async close() {
      await pg.close();
    },
  };
}
