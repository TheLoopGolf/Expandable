import { openDatabase } from "../../src/server/db";
import { getKpis, getInventoryAlerts, getOrderTrend, getProductionTrend, getBacklog, getProductionQueue, getQualitySummary, getActivity } from "../../src/server/queries/dashboard";
import { resolveRange, todayInTz } from "../../src/lib/dates";
async function main() {
  const db = await openDatabase();
  const [org] = await db.query<{ id: string; name: string; timezone: string }>(`select id, name, timezone from organizations where slug = 'northstar'`);
  const [u] = await db.query<{ id: string }>(`select id from profiles where email like 'avery%'`);
  const ctx = { orgId: org.id, orgName: org.name, userId: u.id, userName: "Avery", role: "admin" as const, timezone: org.timezone, now: () => new Date() };
  const today = todayInTz(org.timezone);
  const f = { range: resolveRange("90d", today), today, siteId: null, family: null };
  const t = Date.now();
  const kpis = await getKpis(db, ctx, f);
  console.log(kpis.map((k) => `${k.label}: ${k.value.toFixed(1)} (prev ${k.previous?.toFixed(1)})`).join("\n"));
  const alerts = await getInventoryAlerts(db, ctx, f);
  console.log(alerts.length, "alerts", alerts.slice(0, 6).map((a) => `${a.severity} ${a.title}`));
  const ot = await getOrderTrend(db, ctx, f); console.log(ot.grain, ot.points.length, ot.totals);
  const pt = await getProductionTrend(db, ctx, f); console.log(pt.totals);
  console.log(await getBacklog(db, ctx, f));
  const q = await getProductionQueue(db, ctx, f); console.log(q.slice(0, 6).map((r) => `${r.number} ${r.sku} ${r.status} late=${r.late} ${r.blocker ?? ""}`));
  const qs = await getQualitySummary(db, ctx, f); console.log(qs.severity, qs.overdue.length, qs.activeHolds);
  const act = await getActivity(db, ctx); console.log(act.slice(0, 3));
  console.log("ms", Date.now() - t);
  await db.close();
}
main();
