import { openDatabase } from "../../src/server/db";
async function main() {
  const db = await openDatabase();
  const q = async (label: string, sql: string) => { console.log(`\n== ${label}`); console.table(await db.query(sql)); };
  await q("orgs", "select name, (select count(*) from items i where i.organization_id = o.id) items from organizations o");
  await q("so status", "select status, count(*) from sales_orders group by 1 order by 1");
  await q("wo status", "select status, count(*) from work_orders group by 1 order by 1");
  await q("po status", "select status, count(*) from purchase_orders group by 1 order by 1");
  await q("revenue by month", "select to_char(sh.ship_date,'YYYY-MM') m, round(sum(sl.quantity*sl.unit_price)) rev, count(distinct sh.id) shipments from shipment_lines sl join shipments sh on sh.id=sl.shipment_id group by 1 order by 1");
  await q("intake by month", "select to_char(order_date,'YYYY-MM') m, round(sum(l.quantity_ordered*l.unit_price)) intake from sales_orders so join sales_order_lines l on l.sales_order_id=so.id where so.status<>'canceled' group by 1 order by 1");
  await q("OTD", "select count(*) filter (where sh.ship_date <= l.promised_date)::float/count(*) otd from shipment_lines sl join shipments sh on sh.id=sl.shipment_id join sales_order_lines l on l.id=sl.sales_order_line_id");
  await q("late open WO", "select count(*) from work_orders where status in ('released','in_progress','on_hold') and due_date < current_date");
  await q("late POs", "select count(*) from purchase_orders where status in ('approved','partially_received') and expected_date < current_date");
  await q("quality", "select event_type, status, severity, count(*) from quality_events group by 1,2,3 order by 1,2,3");
  await q("lots", "select status, count(*) from inventory_lots group by 1");
  await q("inv value", "select round(sum(b.qty_on_hand*i.standard_cost)) v from inventory_balances b join items i on i.id=b.item_id");
  await q("fg stock", "select i.sku, sum(b.qty_on_hand) q from inventory_balances b join items i on i.id=b.item_id where i.sku like 'FG-%' group by 1 order by 1");
  await q("journal balance", "select sum(debit) d, sum(credit) c from journal_lines");
  await q("tb", "select a.code, a.name, sum(jl.debit-jl.credit) bal from journal_lines jl join accounts a on a.id=jl.account_id join organizations o on o.id=a.organization_id where o.slug='northstar' group by 1,2 order by 1");
  await q("ledger vs balances", "select count(*) mismatches from (select item_id, warehouse_id, sum(quantity) q from inventory_movements group by 1,2) m full join (select item_id, warehouse_id, sum(qty_on_hand) q from inventory_balances group by 1,2) b using (item_id, warehouse_id) where coalesce(m.q,0) <> coalesce(b.q,0)");
  await q("audit count", "select count(*) from audit_events");
  await q("mrp", "select suggestion_type, is_late, count(*) from mrp_suggestions where status='open' group by 1,2");
  await db.close();
}
main();
