import { describe, expect, it } from "vitest";
import { add, ceilUnit, dec, div, mul, round, sub, toStr } from "@/lib/decimal";

describe("decimal", () => {
  it("parses and formats without floating point drift", () => {
    expect(toStr(add(dec("0.1"), dec("0.2")))).toBe("0.3000");
    expect(toStr(dec("-12.34567"))).toBe("-12.3457");
    expect(toStr(dec(1.005), 2)).toBe("1.01");
  });
  it("multiplies and divides with half-away-from-zero rounding", () => {
    expect(toStr(mul(dec("2.5"), dec("0.012")))).toBe("0.0300");
    expect(toStr(div(dec("10"), dec("3")))).toBe("3.3333");
    expect(toStr(round(dec("2.345"), 2), 2)).toBe("2.35");
    expect(toStr(sub(dec("5"), dec("7.25")))).toBe("-2.2500");
  });
  it("rounds planned quantities up to whole units", () => {
    expect(toStr(ceilUnit(dec("10.0001")), 0)).toBe("11");
    expect(toStr(ceilUnit(dec("10")), 0)).toBe("10");
  });
  it("rejects invalid input", () => {
    expect(() => dec("1e5")).toThrow();
    expect(() => dec("abc")).toThrow();
  });
});
