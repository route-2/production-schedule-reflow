import { DateTime } from "luxon";
import {
  ChangeReason,
  ExecutionSegmentInternal,
  MaintenanceWindow,
  WorkCenterDoc,
  WorkOrderDoc,
} from "./types";
import {
  getCurrentShiftBoundary,
  maxDate,
  minDate,
  nextShiftStart,
  overlaps,
  parseUtc,
} from "../utils/date-utils";

export type TimeInterval = {
  start: DateTime;
  end: DateTime;
  reason:
    | "maintenance-window"
    | "fixed-maintenance-work-order"
    | "scheduled-work-order";
  sourceId?: string;
};

export function buildWorkCenterBlockedIntervals(
  workCenter: WorkCenterDoc,
  allWorkOrders: WorkOrderDoc[],
): TimeInterval[] {
  const maintenanceIntervals = workCenter.data.maintenanceWindows.map(
    (window: MaintenanceWindow): TimeInterval => ({
      start: parseUtc(window.startDate),
      end: parseUtc(window.endDate),
      reason: "maintenance-window",
    }),
  );

  const fixedMaintenanceWorkOrders = allWorkOrders
    .filter(
      (workOrder) =>
        workOrder.data.workCenterId === workCenter.docId &&
        workOrder.data.isMaintenance,
    )
    .map(
      (workOrder): TimeInterval => ({
        start: parseUtc(workOrder.data.startDate),
        end: parseUtc(workOrder.data.endDate),
        reason: "fixed-maintenance-work-order",
        sourceId: workOrder.docId,
      }),
    );

  return mergeIntervals([
    ...maintenanceIntervals,
    ...fixedMaintenanceWorkOrders,
  ]);
}

export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = [...intervals].sort(
    (a, b) => a.start.toMillis() - b.start.toMillis(),
  );

  const merged: TimeInterval[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      last.end = maxDate(last.end, current.end);
      continue;
    }

    merged.push({ ...current });
  }

  return merged;
}

export function addScheduledInterval(
  blocked: TimeInterval[],
  start: DateTime,
  end: DateTime,
  sourceId?: string,
): TimeInterval[] {
  return mergeIntervals([
    ...blocked,
    {
      start,
      end,
      reason: "scheduled-work-order",
      sourceId,
    },
  ]);
}

export function isInsideBlockedInterval(
  time: DateTime,
  blocked: TimeInterval[],
): TimeInterval | null {
  for (const interval of blocked) {
    if (time >= interval.start && time < interval.end) {
      return interval;
    }
  }

  return null;
}

export function findFirstConflictingBlockedInterval(
  start: DateTime,
  end: DateTime,
  blocked: TimeInterval[],
): TimeInterval | null {
  for (const interval of blocked) {
    if (overlaps(start, end, interval.start, interval.end)) {
      return interval;
    }
  }

  return null;
}

export function partitionBlockedIntervals(blocked: TimeInterval[]): {
  hardBlocks: TimeInterval[];
  scheduledBlocks: TimeInterval[];
} {
  const hardBlocks: TimeInterval[] = [];
  const scheduledBlocks: TimeInterval[] = [];

  for (const interval of blocked) {
    if (interval.reason === "scheduled-work-order") {
      scheduledBlocks.push(interval);
    } else {
      hardBlocks.push(interval);
    }
  }

  return {
    hardBlocks,
    scheduledBlocks,
  };
}

export function findFirstOverlappingScheduledInterval(
  start: DateTime,
  end: DateTime,
  scheduledBlocks: TimeInterval[],
): TimeInterval | null {
  for (const interval of scheduledBlocks) {
    if (overlaps(start, end, interval.start, interval.end)) {
      return interval;
    }
  }

  return null;
}

export function findEarliestWorkingTime(
  candidate: DateTime,
  workCenter: WorkCenterDoc,
  blocked: TimeInterval[],
  maxIterations = 1000,
): DateTime {
  let current = candidate.toUTC();

  for (let i = 0; i < maxIterations; i += 1) {
    const activeShift = getCurrentShiftBoundary(current, workCenter.data.shifts);

    if (!activeShift) {
      current = nextShiftStart(current, workCenter.data.shifts);
      continue;
    }

    const blockingInterval = isInsideBlockedInterval(current, blocked);
    if (blockingInterval) {
      current = blockingInterval.end;
      continue;
    }

    return current;
  }

  throw new Error(
    `Unable to find valid working time for work center "${workCenter.docId}" from ${candidate.toISO()}`,
  );
}

/**
 * Schedules a work order while allowing pauses only for:
 * - shift boundaries
 * - maintenance windows
 * - fixed maintenance work orders
 *
 * This function should NOT be used directly for final machine scheduling when
 * there are already scheduled production work orders on the same work center,
 * because it will pause/resume around any blocked interval it receives.
 */
export function scheduleWithinCalendar(
  requestedStart: DateTime,
  durationMinutes: number,
  workCenter: WorkCenterDoc,
  blocked: TimeInterval[],
): {
  start: DateTime;
  end: DateTime;
  appliedReasons: Set<ChangeReason>;
  executionSegments: ExecutionSegmentInternal[];
} {
  if (durationMinutes <= 0) {
    throw new Error(`durationMinutes must be > 0, got ${durationMinutes}`);
  }

  const appliedReasons = new Set<ChangeReason>();
  const executionSegments: ExecutionSegmentInternal[] = [];

  let current = findEarliestWorkingTime(requestedStart, workCenter, blocked);
  const actualStart = current;
  let remainingMinutes = durationMinutes;

  while (remainingMinutes > 0) {
    const activeShift = getCurrentShiftBoundary(current, workCenter.data.shifts);

    if (!activeShift) {
      appliedReasons.add("shift-boundary");
      current = nextShiftStart(current, workCenter.data.shifts);
      current = findEarliestWorkingTime(current, workCenter, blocked);
      continue;
    }

    const nextBlocked = findFirstConflictingBlockedInterval(
      current,
      activeShift.end,
      blocked,
    );

    const availableSegmentEnd = nextBlocked
      ? minDate(activeShift.end, nextBlocked.start)
      : activeShift.end;

    const availableMinutes = Math.floor(
      availableSegmentEnd.diff(current, "minutes").minutes,
    );

    if (availableMinutes <= 0) {
      if (nextBlocked) {
        appliedReasons.add(
          nextBlocked.reason === "scheduled-work-order"
            ? "work-center-conflict"
            : "maintenance-window",
        );
        current = nextBlocked.end;
      } else {
        appliedReasons.add("shift-boundary");
        current = activeShift.end;
      }

      current = findEarliestWorkingTime(current, workCenter, blocked);
      continue;
    }

    const minutesToConsume = Math.min(remainingMinutes, availableMinutes);
    const segmentStart = current;
    const segmentEnd = current.plus({ minutes: minutesToConsume });

    executionSegments.push({
      start: segmentStart,
      end: segmentEnd,
    });

    current = segmentEnd;
    remainingMinutes -= minutesToConsume;

    if (remainingMinutes > 0) {
      if (nextBlocked && current.equals(availableSegmentEnd)) {
        appliedReasons.add(
          nextBlocked.reason === "scheduled-work-order"
            ? "work-center-conflict"
            : "maintenance-window",
        );
      } else if (current.equals(activeShift.end)) {
        appliedReasons.add("shift-boundary");
      }

      current = findEarliestWorkingTime(current, workCenter, blocked);
    }
  }

  return {
    start: actualStart,
    end: current,
    appliedReasons,
    executionSegments,
  };
}

/**
 * Schedules a production work order non-preemptively with respect to other
 * scheduled production work orders on the same work center.
 *
 * Allowed pauses:
 * - shift boundaries
 * - maintenance windows
 * - fixed maintenance work orders
 *
 * Disallowed pauses:
 * - another normal production work order already scheduled on the same machine
 *
 * If the candidate schedule overlaps a scheduled production work order,
 * the whole work order is pushed to the end of that conflicting interval and retried.
 */
export function scheduleNonPreemptiveWithinCalendar(
  requestedStart: DateTime,
  durationMinutes: number,
  workCenter: WorkCenterDoc,
  blocked: TimeInterval[],
  maxIterations = 1000,
): {
  start: DateTime;
  end: DateTime;
  appliedReasons: Set<ChangeReason>;
  executionSegments: ExecutionSegmentInternal[];
} {
  const { hardBlocks, scheduledBlocks } = partitionBlockedIntervals(blocked);

  let candidateStart = requestedStart;
  const accumulatedReasons = new Set<ChangeReason>();

  for (let i = 0; i < maxIterations; i += 1) {
    const scheduled = scheduleWithinCalendar(
      candidateStart,
      durationMinutes,
      workCenter,
      hardBlocks,
    );

    for (const reason of scheduled.appliedReasons) {
      accumulatedReasons.add(reason);
    }

    const conflictingScheduledWorkOrder = findFirstOverlappingScheduledInterval(
      scheduled.start,
      scheduled.end,
      scheduledBlocks,
    );

    if (!conflictingScheduledWorkOrder) {
      return {
        start: scheduled.start,
        end: scheduled.end,
        appliedReasons: accumulatedReasons,
        executionSegments: scheduled.executionSegments,
      };
    }

    accumulatedReasons.add("work-center-conflict");
    candidateStart = conflictingScheduledWorkOrder.end;
  }

  throw new Error(
    `Unable to find non-preemptive slot for work center "${workCenter.docId}" from ${requestedStart.toISO()}`,
  );
}

export function getLatestDependencyEnd(
  workOrder: WorkOrderDoc,
  scheduledByWorkOrderId: Map<string, { start: DateTime; end: DateTime }>,
): DateTime | null {
  const parentIds = workOrder.data.dependsOnWorkOrderIds ?? [];

  if (parentIds.length === 0) {
    return null;
  }

  let latest: DateTime | null = null;

  for (const parentId of parentIds) {
    const parentSchedule = scheduledByWorkOrderId.get(parentId);

    if (!parentSchedule) {
      throw new Error(
        `Missing scheduled dependency "${parentId}" for work order "${workOrder.docId}"`,
      );
    }

    latest = latest ? maxDate(latest, parentSchedule.end) : parentSchedule.end;
  }

  return latest;
}