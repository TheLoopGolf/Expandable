import { describe, expect, it } from "vitest";
import { itemInput, qualityEventInput, workOrderInput } from "@/lib/validation";

describe("form input schemas", () => {
  it("treat an unselected optional reference ('') as null instead of failing validation", () => {
    const wo = workOrderInput.parse({
      itemId: "7b0d6c3e-1f7a-4d5e-9a51-2a8f8c1d9e01",
      quantity: "2",
      plannedStart: "2026-10-11",
      dueDate: "2026-10-14",
      warehouseId: "",
      materialWarehouseId: "",
    });
    expect(wo.warehouseId).toBeNull();
    expect(wo.materialWarehouseId).toBeNull();
    expect(wo.workCenterId).toBeNull();
  });

  it("still rejects malformed identifiers", () => {
    expect(() => workOrderInput.parse({ itemId: "x", quantity: "1", plannedStart: "2026-10-11", dueDate: "2026-10-12", materialWarehouseId: "not-a-uuid" })).toThrow();
  });

  it("applies to every form with optional selects", () => {
    expect(itemInput.shape.preferredSupplierId.parse("")).toBeNull();
    expect(qualityEventInput.shape.lotId.parse("")).toBeNull();
  });
});
