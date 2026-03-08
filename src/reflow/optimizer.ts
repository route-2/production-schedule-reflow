import { WorkCenterDoc, WorkOrderChange, WorkOrderDoc } from "./types";
import { parseUtc } from "../utils/date-utils";

export type WorkCenterMetrics = {
  workCenterId: string;
  workCenterName: string;
  scheduledWorkingMinutes: number;
  availableShiftMinutes: number;
  maintenanceMinutes: number;
  idleMinutes: number;
  utilizationRatio: number;
  makespanMinutes: number;
};

export type OptimizationMetrics = {
  totalDelayMinutes: number;
  movedWorkOrdersCount: number;
  unchangedWorkOrdersCount: number;
  workCenterMetrics: WorkCenterMetrics[];
};

export function computeOptimizationMetrics(
  workCenters: WorkCenterDoc[],
  updatedWorkOrders: WorkOrderDoc[],
  changes: WorkOrderChange[],
): OptimizationMetrics {
  const movedWorkOrdersCount = changes.filter(
    (change) => change.deltaStartMinutes !== 0 || change.deltaEndMinutes !== 0,
  ).length;

  const unchangedWorkOrdersCount = changes.length - movedWorkOrdersCount;

  const totalDelayMinutes = changes.reduce(
    (sum, change) => sum + Math.max(0, change.deltaEndMinutes),
    0,
  );

  const workCenterMetrics = computeWorkCenterMetrics(
    workCenters,
    updatedWorkOrders,
  );

  return {
    totalDelayMinutes,
    movedWorkOrdersCount,
    unchangedWorkOrdersCount,
    workCenterMetrics,
  };
}

export function computeWorkCenterMetrics(
  workCenters: WorkCenterDoc[],
  updatedWorkOrders: WorkOrderDoc[],
): WorkCenterMetrics[] {
  return workCenters.map((workCenter) => {
    const workOrdersForCenter = updatedWorkOrders
      .filter((workOrder) => workOrder.data.workCenterId === workCenter.docId)
      .sort(
        (a, b) =>
          parseUtc(a.data.startDate).toMillis() -
          parseUtc(b.data.startDate).toMillis(),
      );

    const scheduledWorkingMinutes = workOrdersForCenter.reduce(
      (sum, workOrder) =>
        sum +
        workOrder.data.durationMinutes +
        (workOrder.data.setupTimeMinutes ?? 0),
      0,
    );

    const earliestStart =
      workOrdersForCenter.length > 0
        ? parseUtc(workOrdersForCenter[0].data.startDate)
        : null;

    const latestEnd =
      workOrdersForCenter.length > 0
        ? parseUtc(workOrdersForCenter[workOrdersForCenter.length - 1].data.endDate)
        : null;

    let availableShiftMinutes = 0;
    let maintenanceMinutes = 0;
    let makespanMinutes = 0;

    if (earliestStart && latestEnd) {
      makespanMinutes = Math.max(
        0,
        Math.round(latestEnd.diff(earliestStart, "minutes").minutes),
      );

      let cursor = earliestStart.startOf("day");
      const endDay = latestEnd.startOf("day");

      while (cursor <= endDay) {
        const dayOfWeek = cursor.weekday % 7;
        const shiftsForDay = workCenter.data.shifts.filter(
          (shift) => shift.dayOfWeek === dayOfWeek,
        );

        for (const shift of shiftsForDay) {
          const shiftStart = cursor.set({
            hour: shift.startHour,
            minute: 0,
            second: 0,
            millisecond: 0,
          });

          const shiftEnd = cursor.set({
            hour: shift.endHour,
            minute: 0,
            second: 0,
            millisecond: 0,
          });

          const effectiveStart =
            shiftStart < earliestStart ? earliestStart : shiftStart;
          const effectiveEnd = shiftEnd > latestEnd ? latestEnd : shiftEnd;

          if (effectiveStart < effectiveEnd) {
            availableShiftMinutes += Math.round(
              effectiveEnd.diff(effectiveStart, "minutes").minutes,
            );
          }
        }

        cursor = cursor.plus({ days: 1 });
      }

      for (const window of workCenter.data.maintenanceWindows) {
        const maintenanceStart = parseUtc(window.startDate);
        const maintenanceEnd = parseUtc(window.endDate);

        const effectiveStart =
          maintenanceStart < earliestStart ? earliestStart : maintenanceStart;
        const effectiveEnd = maintenanceEnd > latestEnd ? latestEnd : maintenanceEnd;

        if (effectiveStart < effectiveEnd) {
          maintenanceMinutes += Math.round(
            effectiveEnd.diff(effectiveStart, "minutes").minutes,
          );
        }
      }
    }

    const netAvailableShiftMinutes = Math.max(
      0,
      availableShiftMinutes - maintenanceMinutes,
    );

    const idleMinutes = Math.max(
      0,
      netAvailableShiftMinutes - scheduledWorkingMinutes,
    );

    const utilizationRatio =
      netAvailableShiftMinutes === 0
        ? 0
        : scheduledWorkingMinutes / netAvailableShiftMinutes;

    return {
      workCenterId: workCenter.docId,
      workCenterName: workCenter.data.name,
      scheduledWorkingMinutes,
      availableShiftMinutes: netAvailableShiftMinutes,
      maintenanceMinutes,
      idleMinutes,
      utilizationRatio,
      makespanMinutes,
    };
  });
}