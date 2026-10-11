import { NextResponse } from "next/server";
import { databaseMode, getDb } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe for deployments: confirms the database answers a query. */
export async function GET() {
  try {
    const db = await getDb();
    await db.query("select 1");
    return NextResponse.json({ ok: true, database: databaseMode() });
  } catch {
    return NextResponse.json({ ok: false, error: "database unavailable" }, { status: 503 });
  }
}
