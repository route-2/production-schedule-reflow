import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  buildTopologicalOrder,
  detectCycle,
} from "../src/reflow/graph";
import { WorkOrderDoc } from "../src/reflow/types";

function makeWorkOrder(
  docId: string,
  dependsOnWorkOrderIds: string[] = [],
): WorkOrderDoc {
  return {
    docId,
    docType: "workOrder",
    data: {
      workOrderNumber: docId.toUpperCase(),
      manufacturingOrderId: "mo-1",
      workCenterId: "wc-1",
      startDate: "2026-03-02T08:00:00Z",
      endDate: "2026-03-02T09:00:00Z",
      durationMinutes: 60,
      isMaintenance: false,
      dependsOnWorkOrderIds,
    },
  };
}

describe("graph", () => {
  it("builds a valid topological order for a dependency chain", () => {
    const wo1 = makeWorkOrder("wo-1");
    const wo2 = makeWorkOrder("wo-2", ["wo-1"]);
    const wo3 = makeWorkOrder("wo-3", ["wo-2"]);

    const ordered = buildTopologicalOrder([wo3, wo1, wo2]);

    expect(ordered.map((w) => w.docId)).toEqual(["wo-1", "wo-2", "wo-3"]);
  });

  it("supports multiple parents", () => {
    const wo1 = makeWorkOrder("wo-1");
    const wo2 = makeWorkOrder("wo-2");
    const wo3 = makeWorkOrder("wo-3", ["wo-1", "wo-2"]);

    const ordered = buildTopologicalOrder([wo3, wo2, wo1]);
    const ids = ordered.map((w) => w.docId);

    expect(ids.indexOf("wo-1")).toBeLessThan(ids.indexOf("wo-3"));
    expect(ids.indexOf("wo-2")).toBeLessThan(ids.indexOf("wo-3"));
  });

  it("detects cycles", () => {
    const wo1 = makeWorkOrder("wo-1", ["wo-3"]);
    const wo2 = makeWorkOrder("wo-2", ["wo-1"]);
    const wo3 = makeWorkOrder("wo-3", ["wo-2"]);

    const graph = buildDependencyGraph([wo1, wo2, wo3]);
    const cycle = detectCycle(graph);

    expect(cycle.hasCycle).toBe(true);
    expect(cycle.cyclePath.length).toBeGreaterThan(0);
  });

  it("throws on missing dependencies", () => {
    const wo1 = makeWorkOrder("wo-1", ["wo-missing"]);

    expect(() => buildDependencyGraph([wo1])).toThrow(/Missing dependency/);
  });
});