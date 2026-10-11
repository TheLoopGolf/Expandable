import { describe, expect, it } from "vitest";
import { dec, toStr } from "@/lib/decimal";
import { runMrp, type MrpItem } from "@/lib/domain/mrp";
import type { BomMap } from "@/lib/domain/bom";

const item = (id: string, type: MrpItem["itemType"], lead: number, moq = "1", safety = "0"): MrpItem => ({
  id,
  sku: id,
  name: id,
  itemType: type,
  leadTimeDays: lead,
  safetyStock: dec(safety),
  minOrderQty: dec(moq),
  supplierId: type === "purchased" ? "SUP" : null,
});

const bomMap: BomMap = new Map([["FG", [{ componentItemId: "RAW", quantityPer: dec(2), scrapPct: dec(0) }]]]);

describe("MRP", () => {
  it("nets demand against stock and scheduled receipts and explodes planned orders", () => {
    const result = runMrp({
      today: "2026-03-02",
      horizonDays: 60,
      items: [item("FG", "manufactured", 5, "10"), item("RAW", "purchased", 14, "50")],
      bomMap,
      onHand: new Map([["FG", dec(5)], ["RAW", dec(10)]]),
      demands: [{ itemId: "FG", date: "2026-03-20", quantity: dec(30), source: { type: "sales_order", ref: "SO-1" } }],
      supplies: [{ itemId: "FG", date: "2026-03-10", quantity: dec(5), source: { type: "work_order", ref: "WO-1" } }],
    });
    const fg = result.planned.find((p) => p.itemId === "FG")!;
    expect(fg.type).toBe("manufacture");
    expect(toStr(fg.quantity, 0)).toBe("20"); // 30 - 5 - 5
    expect(fg.needDate).toBe("2026-03-20");
    expect(fg.releaseDate).toBe("2026-03-15");
    expect(fg.isLate).toBe(false);
    expect(fg.pegging[0].ref).toBe("SO-1");
    const raw = result.planned.find((p) => p.itemId === "RAW")!;
    // dependent demand 40 at FG release date, 10 on hand => 30 short, MOQ 50
    expect(toStr(raw.quantity, 0)).toBe("50");
    expect(raw.needDate).toBe("2026-03-15");
    expect(raw.releaseDate).toBe("2026-03-01");
    expect(raw.isLate).toBe(true);
    expect(raw.explanation).toContain("Planned WO FG");
  });

  it("replenishes to safety stock and treats past-due demand as today", () => {
    const result = runMrp({
      today: "2026-03-02",
      horizonDays: 30,
      items: [item("RAW", "purchased", 3, "1", "20")],
      bomMap: new Map(),
      onHand: new Map([["RAW", dec(5)]]),
      demands: [{ itemId: "RAW", date: "2026-02-20", quantity: dec(5), source: { type: "work_order", ref: "WO-9" } }],
      supplies: [],
    });
    const total = result.planned.reduce((s, p) => s + Number(toStr(p.quantity)), 0);
    expect(total).toBe(20); // ends at safety stock
    expect(result.planned.every((p) => p.needDate === "2026-03-02")).toBe(true);
  });

  it("ignores demand beyond the horizon", () => {
    const result = runMrp({
      today: "2026-03-02",
      horizonDays: 10,
      items: [item("RAW", "purchased", 3)],
      bomMap: new Map(),
      onHand: new Map(),
      demands: [{ itemId: "RAW", date: "2026-05-01", quantity: dec(5), source: { type: "sales_order", ref: "SO-2" } }],
      supplies: [],
    });
    expect(result.planned).toHaveLength(0);
  });
});
