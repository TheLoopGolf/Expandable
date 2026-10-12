import fs from "node:fs";
import path from "node:path";
import { PGlite, types } from "@electric-sql/pglite";
import type { Database, Sql, TxSql } from "./types";

const parsers = {
  // Business dates stay as 'YYYY-MM-DD' strings to avoid timezone shifts.
  [types.DATE]: (value: string) => value,
  [types.INT8]: (value: string) => Number(value),
};

export async function createPgliteDatabase(dataDir?: string): Promise<Database> {
  const persistent = dataDir && dataDir !== "memory://" ? path.resolve(dataDir) : undefined;
  if (persistent) fs.mkdirSync(path.dirname(persistent), { recursive: true });
  const pg = new PGlite(persistent, {
    relaxedDurability: process.env.PGLITE_RELAXED_DURABILITY === "true",
  });
  await pg.waitReady;
  await pg.exec("set timezone = 'UTC'");

  const wrap = (q: { query: PGlite["query"] }): Sql => ({
    async query<T>(text: string, params?: readonly unknown[]) {
      // Parsers must be passed per query: PGlite 0.5 ignores the constructor-level option.
      const result = await q.query<T>(text, params ? [...params] : undefined, { parsers });
      return result.rows;
    },
  });

  return {
    kind: "pglite",
    ...wrap(pg),
    async exec(text: string) {
      await pg.exec(text);
    },
    transaction<T>(fn: (tx: TxSql) => Promise<T>) {
      return pg.transaction((tx) =>
        fn({
          ...wrap(tx),
          async exec(text: string) {
            await tx.exec(text);
          },
        }),
      );
    },
    async close() {
      await pg.close();
    },
  };
}
