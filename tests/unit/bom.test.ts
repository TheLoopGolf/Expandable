import { describe, expect, it } from "vitest";
import { dec, toStr } from "@/lib/decimal";
import { BomCycleError, explodeBom, findBomCycle, flattenRequirements, lowLevelCodes, rollupCosts, whereUsed, type BomMap } from "@/lib/domain/bom";

const line = (componentItemId: string, q: string, scrap = "0") => ({ componentItemId, quantityPer: dec(q), scrapPct: dec(scrap) });

const bomMap: BomMap = new Map([
  ["FG", [line("SUB", "1"), line("SCREW", "4", "5")]],
  ["SUB", [line("PCB", "1"), line("CAP", "10", "2")]],
]);

describe("BOM explosion", () => {
  it("explodes multiple levels with scrap allowance", () => {
    const lines = explodeBom("FG", dec(10), bomMap);
    const byItem = Object.fromEntries(lines.map((l) => [l.itemId, l]));
    expect(byItem.SUB.level).toBe(1);
    expect(toStr(byItem.SCREW.extendedQty)).toBe("42.0000"); // 10 × 4 × 1.05
    expect(byItem.CAP.level).toBe(2);
    expect(toStr(byItem.CAP.extendedQty)).toBe("102.0000"); // 10 × 1 × 10 × 1.02
    const leaves = flattenRequirements(lines);
    expect([...leaves.keys()].sort()).toEqual(["CAP", "PCB", "SCREW"]);
  });

  it("computes low-level codes", () => {
    const codes = lowLevelCodes(["FG", "SUB", "PCB", "CAP", "SCREW"], bomMap);
    expect(codes.get("FG")).toBe(0);
    expect(codes.get("SUB")).toBe(1);
    expect(codes.get("CAP")).toBe(2);
  });

  it("rolls up standard cost with labor", () => {
    const costs = { PCB: "3", CAP: "0.01", SCREW: "0.05" } as Record<string, string>;
    const rolled = rollupCosts(["FG"], bomMap, (id) => dec(costs[id] ?? "0"), (id) => (id === "SUB" ? dec("1.5") : 0n));
    // SUB = 3 + 10×1.02×0.01 + 1.5 = 4.602 ; FG = 4.602 + 4×1.05×0.05 = 4.812
    expect(toStr(rolled.get("SUB")!.total)).toBe("4.6020");
    expect(toStr(rolled.get("FG")!.total)).toBe("4.8120");
  });

  it("finds where-used across levels", () => {
    expect(whereUsed("CAP", bomMap)).toEqual([
      { assemblyId: "SUB", level: 1 },
      { assemblyId: "FG", level: 2 },
    ]);
  });
});

describe("circular references", () => {
  it("detects a cycle introduced by a proposed edit", () => {
    expect(findBomCycle(bomMap)).toBeNull();
    const cycle = findBomCycle(bomMap, { assemblyId: "SUB", componentIds: ["PCB", "FG"] });
    expect(cycle).toEqual(["SUB", "FG", "SUB"]);
  });
  it("rejects self reference and throws during explosion", () => {
    const bad: BomMap = new Map([
      ["A", [line("B", "1")]],
      ["B", [line("A", "1")]],
    ]);
    expect(() => explodeBom("A", dec(1), bad)).toThrow(BomCycleError);
    expect(findBomCycle(new Map(), { assemblyId: "X", componentIds: ["X"] })).toEqual(["X", "X"]);
  });
});
