/**
 * Driver parity: the services must behave the same on PGlite (demo/tests) and postgres.js
 * (Supabase). Runs only when TEST_DATABASE_URL points at a disposable PostgreSQL database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";
import { createPgliteDatabase } from "@/server/db/pglite";
import { createPostgresDatabase } from "@/server/db/postgres";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("postgres.js adapter matches PGlite", () => {
  let pg: Database;
  let lite: Database;
  const setup = `create temporary table if not exists parity (id int primary key, doc jsonb, amount numeric(14,4), day date, big bigint, tags text[])`;

  beforeAll(async () => {
    pg = createPostgresDatabase(url!);
    lite = await createPgliteDatabase("memory://");
  });
  afterAll(async () => {
    await pg?.close();
    await lite?.close();
  });

  it("round-trips JSON text, numerics, dates, bigints and arrays identically", async () => {
    const results = [];
    for (const db of [pg, lite]) {
      const row = await db.transaction(async (tx) => {
        await tx.exec(`${setup}; delete from parity;`);
        await tx.query(`insert into parity values (1, $1::jsonb, $2::numeric, $3::date, $4, $5::text[])`, [
          JSON.stringify({ lines: [{ sku: "A", qty: 2 }] }),
          "6.2000",
          "2026-10-12",
          9007199254,
          "{a,b}",
        ]);
        const [r] = await tx.query(`select doc, jsonb_typeof(doc) as kind, amount, day, big, tags from parity where id = 1`);
        return r;
      });
      results.push(row);
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ kind: "object", doc: { lines: [{ sku: "A", qty: 2 }] }, amount: "6.2000", day: "2026-10-12", big: 9007199254 });
  });
});
