import fs from "fs";
import path from "path";
import { DateTime } from "luxon";
import {
  InputDocuments,
  ManufacturingOrderDoc,
  WorkCenterDoc,
  WorkOrderDoc,
} from "../reflow/types";

type GenerateOptions = {
  workCenterCount: number;
  manufacturingOrderCount: number;
  workOrdersPerManufacturingOrder: number;
  startDateIso: string;
};

function makeWorkCenters(count: number): WorkCenterDoc[] {
  const workCenters: WorkCenterDoc[] = [];

  for (let i = 1; i <= count; i += 1) {
    workCenters.push({
      docId: `wc-${i}`,
      docType: "workCenter",
      data: {
        name: `Extrusion Line ${i}`,
        shifts: [
          { dayOfWeek: 1, startHour: 8, endHour: 17 },
          { dayOfWeek: 2, startHour: 8, endHour: 17 },
          { dayOfWeek: 3, startHour: 8, endHour: 17 },
          { dayOfWeek: 4, startHour: 8, endHour: 17 },
          { dayOfWeek: 5, startHour: 8, endHour: 17 },
        ],
        maintenanceWindows:
          i % 8 === 0
            ? [
                {
                  startDate: "2026-03-11T10:00:00Z",
                  endDate: "2026-03-11T12:00:00Z",
                  reason: "Planned maintenance",
                },
              ]
            : [],
      },
    });
  }

  return workCenters;
}

function makeManufacturingOrders(count: number): ManufacturingOrderDoc[] {
  const mos: ManufacturingOrderDoc[] = [];

  for (let i = 1; i <= count; i += 1) {
    mos.push({
      docId: `mo-${i}`,
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: `MO-${1000 + i}`,
        itemId: `pipe-${100 + (i % 7) * 50}mm`,
        quantity: 100 + (i % 10) * 100,
        dueDate: DateTime.fromISO("2026-03-20T17:00:00Z")
          .plus({ days: i % 10 })
          .toUTC()
          .toISO()!,
      },
    });
  }

  return mos;
}

function makeWorkOrders(
  manufacturingOrders: ManufacturingOrderDoc[],
  workCenters: WorkCenterDoc[],
  workOrdersPerManufacturingOrder: number,
  startDateIso: string,
): WorkOrderDoc[] {
  const workOrders: WorkOrderDoc[] = [];
  const baseStart = DateTime.fromISO(startDateIso, { zone: "utc" });

  let globalWorkOrderIndex = 1;

  for (let moIndex = 0; moIndex < manufacturingOrders.length; moIndex += 1) {
    const mo = manufacturingOrders[moIndex];
    let previousWorkOrderId: string | null = null;

    for (let step = 0; step < workOrdersPerManufacturingOrder; step += 1) {
      const workCenter =
  workCenters[(moIndex * 3 + step * 7) % workCenters.length];
      const scheduledStart = baseStart
  .plus({
    days: Math.floor(moIndex / 3),
    hours: (step % 4) * 2,
    minutes: (moIndex % 6) * 10,
  })
  .toUTC();

      const plannedDurationMinutes = 60 + ((globalWorkOrderIndex % 4) + 1) * 30;

      // Introduce occasional overruns to trigger reflow
      const actualDurationMinutes =
        globalWorkOrderIndex % 25 === 0
          ? plannedDurationMinutes + 60
          : plannedDurationMinutes;

      const plannedEnd = scheduledStart
        .plus({ minutes: plannedDurationMinutes })
        .toUTC();

      const dependsOnWorkOrderIds =
        previousWorkOrderId !== null ? [previousWorkOrderId] : [];

      // Occasionally create a second parent for richer DAGs
      if (
        step >= 2 &&
        globalWorkOrderIndex % 11 === 0 &&
        workOrders.length >= 2
      ) {
        const anotherParent = workOrders[workOrders.length - 2]?.docId;
        if (anotherParent && !dependsOnWorkOrderIds.includes(anotherParent)) {
          dependsOnWorkOrderIds.push(anotherParent);
        }
      }

      const workOrder: WorkOrderDoc = {
        docId: `wo-${globalWorkOrderIndex}`,
        docType: "workOrder",
        data: {
          workOrderNumber: `WO-${globalWorkOrderIndex}`,
          manufacturingOrderId: mo.docId,
          workCenterId: workCenter.docId,
          startDate: scheduledStart.toISO()!,
          endDate: plannedEnd.toISO()!,
          durationMinutes: actualDurationMinutes,
          isMaintenance: false,
          dependsOnWorkOrderIds,
          setupTimeMinutes: globalWorkOrderIndex % 13 === 0 ? 15 : 0,
        },
      };

      workOrders.push(workOrder);
      previousWorkOrderId = workOrder.docId;
      globalWorkOrderIndex += 1;
    }
  }

  return workOrders;
}

function generateLargeScenario(options: GenerateOptions): InputDocuments {
  const workCenters = makeWorkCenters(options.workCenterCount);
  const manufacturingOrders = makeManufacturingOrders(
    options.manufacturingOrderCount,
  );
  const workOrders = makeWorkOrders(
    manufacturingOrders,
    workCenters,
    options.workOrdersPerManufacturingOrder,
    options.startDateIso,
  );

  return {
    workCenters,
    manufacturingOrders,
    workOrders,
  };
}

function main(): void {
  const scenario = generateLargeScenario({
    workCenterCount: 50,
    manufacturingOrderCount: 250,
    workOrdersPerManufacturingOrder: 20,
    startDateIso: "2026-03-10T08:00:00Z",
  });

  const outputPath = path.resolve(
    process.cwd(),
    "data/generated/generated-large-scenario.json",
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(scenario, null, 2), "utf-8");

  console.log(`Saved large scenario to ${outputPath}`);
  console.log(`Work centers: ${scenario.workCenters.length}`);
  console.log(`Manufacturing orders: ${scenario.manufacturingOrders.length}`);
  console.log(`Work orders: ${scenario.workOrders.length}`);
}

main();