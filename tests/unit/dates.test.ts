import { describe, expect, it } from "vitest";
import { addMonths, dateInTz, resolveRange, startOfWeek } from "@/lib/dates";

describe("dates", () => {
  it("computes business dates in the org timezone", () => {
    // 03:30 UTC on Mar 10 is still Mar 9 in Chicago
    expect(dateInTz(new Date("2026-03-10T03:30:00Z"), "America/Chicago")).toBe("2026-03-09");
    expect(dateInTz(new Date("2026-03-10T03:30:00Z"), "UTC")).toBe("2026-03-10");
  });
  it("handles month arithmetic at month ends", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(startOfWeek("2026-10-11")).toBe("2026-10-05");
  });
  it("resolves ranges with an equal-length comparison period", () => {
    const mtd = resolveRange("mtd", "2026-10-11");
    expect(mtd).toMatchObject({ from: "2026-10-01", to: "2026-10-11", prevFrom: "2026-09-01", prevTo: "2026-09-11" });
    const d30 = resolveRange("30d", "2026-10-11");
    expect(d30).toMatchObject({ from: "2026-09-12", prevTo: "2026-09-11", prevFrom: "2026-08-13", days: 30 });
  });
});
