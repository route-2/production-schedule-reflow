import { describe, expect, it } from "vitest";
import { ReflowService } from "../src/reflow/reflow.service";
import { InputDocuments } from "../src/reflow/types";

describe("reflow integration", () => {
  it("reflows a delay cascade", () => {
    const input: InputDocuments = {
      workCenters: [
        {
          docId: "wc-1",
          docType: "workCenter",
          data: {
            name: "Extrusion Line 1",
            shifts: [
              { dayOfWeek: 1, startHour: 8, endHour: 17 },
              { dayOfWeek: 2, startHour: 8, endHour: 17 },
              { dayOfWeek: 3, startHour: 8, endHour: 17 },
              { dayOfWeek: 4, startHour: 8, endHour: 17 },
              { dayOfWeek: 5, startHour: 8, endHour: 17 },
            ],
            maintenanceWindows: [],
          },
        },
      ],
      manufacturingOrders: [
        {
          docId: "mo-1",
          docType: "manufacturingOrder",
          data: {
            manufacturingOrderNumber: "MO-100",
            itemId: "pipe-200mm",
            quantity: 1000,
            dueDate: "2026-03-10T17:00:00Z",
          },
        },
      ],
      workOrders: [
        {
          docId: "wo-1",
          docType: "workOrder",
          data: {
            workOrderNumber: "WO-1",
            manufacturingOrderId: "mo-1",
            workCenterId: "wc-1",
            startDate: "2026-03-02T08:00:00Z",
            endDate: "2026-03-02T10:00:00Z",
            durationMinutes: 180,
            isMaintenance: false,
            dependsOnWorkOrderIds: [],
          },
        },
        {
          docId: "wo-2",
          docType: "workOrder",
          data: {
            workOrderNumber: "WO-2",
            manufacturingOrderId: "mo-1",
            workCenterId: "wc-1",
            startDate: "2026-03-02T10:00:00Z",
            endDate: "2026-03-02T12:00:00Z",
            durationMinutes: 120,
            isMaintenance: false,
            dependsOnWorkOrderIds: ["wo-1"],
          },
        },
        {
          docId: "wo-3",
          docType: "workOrder",
          data: {
            workOrderNumber: "WO-3",
            manufacturingOrderId: "mo-1",
            workCenterId: "wc-1",
            startDate: "2026-03-02T12:00:00Z",
            endDate: "2026-03-02T14:00:00Z",
            durationMinutes: 120,
            isMaintenance: false,
            dependsOnWorkOrderIds: ["wo-2"],
          },
        },
      ],
    };

    const result = new ReflowService().reflow(input);

    const wo1 = result.updatedWorkOrders.find((w) => w.docId === "wo-1");
    const wo2 = result.updatedWorkOrders.find((w) => w.docId === "wo-2");
    const wo3 = result.updatedWorkOrders.find((w) => w.docId === "wo-3");

    expect(wo1?.data.endDate).toBe("2026-03-02T11:00:00Z");
    expect(wo2?.data.startDate).toBe("2026-03-02T11:00:00Z");
    expect(wo2?.data.endDate).toBe("2026-03-02T13:00:00Z");
    expect(wo3?.data.startDate).toBe("2026-03-02T13:00:00Z");
    expect(wo3?.data.endDate).toBe("2026-03-02T15:00:00Z");

    const wo1Change = result.changes.find((c) => c.workOrderId === "wo-1");
    const wo2Change = result.changes.find((c) => c.workOrderId === "wo-2");

    expect(wo1Change?.reasons).toContain("duration-overrun");
    expect(wo2Change?.reasons).toContain("dependency");
  });

  it("throws on cyclic dependencies", () => {
    const input: InputDocuments = {
      workCenters: [
        {
          docId: "wc-1",
          docType: "workCenter",
          data: {
            name: "Extrusion Line 1",
            shifts: [
              { dayOfWeek: 1, startHour: 8, endHour: 17 },
              { dayOfWeek: 2, startHour: 8, endHour: 17 },
              { dayOfWeek: 3, startHour: 8, endHour: 17 },
              { dayOfWeek: 4, startHour: 8, endHour: 17 },
              { dayOfWeek: 5, startHour: 8, endHour: 17 },
            ],
            maintenanceWindows: [],
          },
        },
      ],
      manufacturingOrders: [
        {
          docId: "mo-1",
          docType: "manufacturingOrder",
          data: {
            manufacturingOrderNumber: "MO-500",
            itemId: "pipe-300mm",
            quantity: 300,
            dueDate: "2026-03-14T17:00:00Z",
          },
        },
      ],
      workOrders: [
        {
          docId: "wo-9",
          docType: "workOrder",
          data: {
            workOrderNumber: "WO-9",
            manufacturingOrderId: "mo-1",
            workCenterId: "wc-1",
            startDate: "2026-03-06T08:00:00Z",
            endDate: "2026-03-06T09:00:00Z",
            durationMinutes: 60,
            isMaintenance: false,
            dependsOnWorkOrderIds: ["wo-11"],
          },
        },
        {
          docId: "wo-10",
          docType: "workOrder",
          data: {
            workOrderNumber: "WO-10",
            manufacturingOrderId: "mo-1",
            workCenterId: "wc-1",
            startDate: "2026-03-06T09:00:00Z",
            endDate: "2026-03-06T10:00:00Z",
            durationMinutes: 60,
            isMaintenance: false,
            dependsOnWorkOrderIds: ["wo-9"],
          },
        },
        {
          docId: "wo-11",
          docType: "workOrder",
          data: {
            workOrderNumber: "WO-11",
            manufacturingOrderId: "mo-1",
            workCenterId: "wc-1",
            startDate: "2026-03-06T10:00:00Z",
            endDate: "2026-03-06T11:00:00Z",
            durationMinutes: 60,
            isMaintenance: false,
            dependsOnWorkOrderIds: ["wo-10"],
          },
        },
      ],
    };

    expect(() => new ReflowService().reflow(input)).toThrow(
      /Cyclic dependency detected/,
    );
  });
});