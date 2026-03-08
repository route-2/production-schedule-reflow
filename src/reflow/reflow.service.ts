import { DateTime } from "luxon";
import { ConstraintChecker } from "./constraint-checker";
import {
  ChangeReason,
  ExecutionSegmentInternal,
  InputDocuments,
  ReflowOptions,
  ReflowResult,
  WorkCenterDoc,
  WorkOrderChange,
  WorkOrderDoc,
} from "./types";
import { buildTopologicalOrder } from "./graph";
import {
  addScheduledInterval,
  buildWorkCenterBlockedIntervals,
  getLatestDependencyEnd,
  scheduleNonPreemptiveWithinCalendar,
  TimeInterval,
} from "./calendar";
import { diffMinutes, parseUtc, toUtcIso } from "../utils/date-utils";

export class ReflowService {
  reflow(
    input: InputDocuments,
    options: ReflowOptions = {
      preserveOriginalStartAsLowerBound: true,
    },
  ): ReflowResult {
    const workCenterById = this.indexWorkCenters(input.workCenters);
    const orderedWorkOrders = buildTopologicalOrder(input.workOrders);

    const blockedByWorkCenterId = new Map<string, TimeInterval[]>();
    const scheduledByWorkOrderId = new Map<
      string,
      { start: DateTime; end: DateTime; reasons: Set<ChangeReason> }
    >();

    const executionSegmentsByWorkOrderId = new Map<
      string,
      ExecutionSegmentInternal[]
    >();

    for (const workCenter of input.workCenters) {
      blockedByWorkCenterId.set(
        workCenter.docId,
        buildWorkCenterBlockedIntervals(workCenter, input.workOrders),
      );
    }

    for (const workOrder of orderedWorkOrders) {
      const workCenter = workCenterById.get(workOrder.data.workCenterId);

      if (!workCenter) {
        throw new Error(
          `Missing work center "${workOrder.data.workCenterId}" for work order "${workOrder.docId}"`,
        );
      }

      if (workOrder.data.isMaintenance) {
        const maintenanceStart = parseUtc(workOrder.data.startDate);
        const maintenanceEnd = parseUtc(workOrder.data.endDate);

        scheduledByWorkOrderId.set(workOrder.docId, {
          start: maintenanceStart,
          end: maintenanceEnd,
          reasons: new Set<ChangeReason>(["unchanged" as ChangeReason]),
        });

        executionSegmentsByWorkOrderId.set(workOrder.docId, [
          {
            start: maintenanceStart,
            end: maintenanceEnd,
          },
        ]);

        continue;
      }

      const blocked = blockedByWorkCenterId.get(workCenter.docId) ?? [];
      const originalStart = parseUtc(workOrder.data.startDate);
      const originalEnd = parseUtc(workOrder.data.endDate);

      const dependencyEnd = getLatestDependencyEnd(
        workOrder,
        scheduledByWorkOrderId,
      );

      let requestedStart = originalStart;
      const initialReasons = new Set<ChangeReason>();

      if (dependencyEnd && dependencyEnd > requestedStart) {
        requestedStart = dependencyEnd;
        initialReasons.add("dependency");
      }

      if (options.preserveOriginalStartAsLowerBound === false && dependencyEnd) {
        requestedStart = dependencyEnd;
      } else if (
        options.preserveOriginalStartAsLowerBound === false &&
        !dependencyEnd
      ) {
        requestedStart = originalStart;
      }

      const scheduled = scheduleNonPreemptiveWithinCalendar(
        requestedStart,
        workOrder.data.durationMinutes + (workOrder.data.setupTimeMinutes ?? 0),
        workCenter,
        blocked,
      );

      const finalReasons = new Set<ChangeReason>([
        ...initialReasons,
        ...scheduled.appliedReasons,
      ]);

      if (finalReasons.size === 0) {
        if (
          scheduled.start.toMillis() === originalStart.toMillis() &&
          scheduled.end.toMillis() === originalEnd.toMillis()
        ) {
          finalReasons.add("unchanged");
        } else {
          finalReasons.add("duration-overrun");
        }
      }

      scheduledByWorkOrderId.set(workOrder.docId, {
        start: scheduled.start,
        end: scheduled.end,
        reasons: finalReasons,
      });

      executionSegmentsByWorkOrderId.set(
        workOrder.docId,
        scheduled.executionSegments,
      );

      blockedByWorkCenterId.set(
        workCenter.docId,
        addScheduledInterval(
          blocked,
          scheduled.start,
          scheduled.end,
          workOrder.docId,
        ),
      );
    }

    const updatedWorkOrders = orderedWorkOrders.map((workOrder) =>
      this.toUpdatedWorkOrder(workOrder, scheduledByWorkOrderId),
    );

    const changes = orderedWorkOrders.map((workOrder) =>
      this.toWorkOrderChange(workOrder, scheduledByWorkOrderId),
    );

    const explanation = this.buildExplanation(
      orderedWorkOrders,
      scheduledByWorkOrderId,
      changes,
    );

    const validation = new ConstraintChecker().validate(
      input,
      updatedWorkOrders,
      executionSegmentsByWorkOrderId,
    );

    if (!validation.isValid) {
      throw new Error(
        `Reflow produced an invalid schedule:\n${validation.errors
          .map((error) => `- [${error.type}] ${error.message}`)
          .join("\n")}`,
      );
    }

    return {
      updatedWorkOrders,
      changes,
      explanation,
      executionSegmentsByWorkOrderId,
    };
  }

  private indexWorkCenters(
    workCenters: WorkCenterDoc[],
  ): Map<string, WorkCenterDoc> {
    const map = new Map<string, WorkCenterDoc>();

    for (const workCenter of workCenters) {
      map.set(workCenter.docId, workCenter);
    }

    return map;
  }

  private toUpdatedWorkOrder(
    workOrder: WorkOrderDoc,
    scheduledByWorkOrderId: Map<
      string,
      { start: DateTime; end: DateTime; reasons: Set<ChangeReason> }
    >,
  ): WorkOrderDoc {
    const scheduled = scheduledByWorkOrderId.get(workOrder.docId);

    if (!scheduled) {
      throw new Error(
        `Missing scheduled result for work order "${workOrder.docId}"`,
      );
    }

    return {
      ...workOrder,
      data: {
        ...workOrder.data,
        startDate: toUtcIso(scheduled.start),
        endDate: toUtcIso(scheduled.end),
      },
    };
  }

  private toWorkOrderChange(
    workOrder: WorkOrderDoc,
    scheduledByWorkOrderId: Map<
      string,
      { start: DateTime; end: DateTime; reasons: Set<ChangeReason> }
    >,
  ): WorkOrderChange {
    const scheduled = scheduledByWorkOrderId.get(workOrder.docId);

    if (!scheduled) {
      throw new Error(
        `Missing scheduled change result for work order "${workOrder.docId}"`,
      );
    }

    const oldStart = parseUtc(workOrder.data.startDate);
    const oldEnd = parseUtc(workOrder.data.endDate);
    const newStart = scheduled.start;
    const newEnd = scheduled.end;

    const deltaStartMinutes = diffMinutes(newStart, oldStart);
    const deltaEndMinutes = diffMinutes(newEnd, oldEnd);

    const reasons =
      deltaStartMinutes === 0 &&
      deltaEndMinutes === 0 &&
      scheduled.reasons.size === 0
        ? (["unchanged"] as ChangeReason[])
        : Array.from(scheduled.reasons);

    return {
      workOrderId: workOrder.docId,
      workOrderNumber: workOrder.data.workOrderNumber,
      oldStartDate: toUtcIso(oldStart),
      oldEndDate: toUtcIso(oldEnd),
      newStartDate: toUtcIso(newStart),
      newEndDate: toUtcIso(newEnd),
      deltaStartMinutes,
      deltaEndMinutes,
      reasons,
      explanation: this.buildSingleChangeExplanation(
        workOrder.data.workOrderNumber,
        deltaStartMinutes,
        deltaEndMinutes,
        reasons,
      ),
    };
  }

  private buildSingleChangeExplanation(
    workOrderNumber: string,
    deltaStartMinutes: number,
    deltaEndMinutes: number,
    reasons: ChangeReason[],
  ): string {
    if (
      deltaStartMinutes === 0 &&
      deltaEndMinutes === 0 &&
      reasons.includes("unchanged")
    ) {
      return `${workOrderNumber} did not move.`;
    }

    return `${workOrderNumber} moved start by ${deltaStartMinutes} minutes and end by ${deltaEndMinutes} minutes due to ${reasons.join(", ")}.`;
  }

  private buildExplanation(
    orderedWorkOrders: WorkOrderDoc[],
    scheduledByWorkOrderId: Map<
      string,
      { start: DateTime; end: DateTime; reasons: Set<ChangeReason> }
    >,
    changes: WorkOrderChange[],
  ): string[] {
    const explanation: string[] = [];

    explanation.push(
      "Built a dependency DAG and scheduled work orders in topological order.",
    );
    explanation.push(
      "Used each work center as a constrained calendar with shifts, maintenance windows, and previously scheduled work blocked out.",
    );
    explanation.push(
      "Computed each work order at the earliest valid time that satisfied dependencies, work-center capacity, and calendar constraints.",
    );

    const moved = changes.filter(
      (change) =>
        change.deltaStartMinutes !== 0 || change.deltaEndMinutes !== 0,
    );

    if (moved.length === 0) {
      explanation.push("No work orders required reflow.");
    } else {
      explanation.push(
        `${moved.length} work orders were affected during reflow.`,
      );
    }

    for (const workOrder of orderedWorkOrders) {
      const scheduled = scheduledByWorkOrderId.get(workOrder.docId);

      if (!scheduled) {
        continue;
      }

      const oldStart = parseUtc(workOrder.data.startDate);
      const oldEnd = parseUtc(workOrder.data.endDate);

      if (
        oldStart.toMillis() !== scheduled.start.toMillis() ||
        oldEnd.toMillis() !== scheduled.end.toMillis()
      ) {
        explanation.push(
          `${workOrder.data.workOrderNumber}: ${toUtcIso(oldStart)}-${toUtcIso(oldEnd)} -> ${toUtcIso(scheduled.start)}-${toUtcIso(scheduled.end)} because ${Array.from(scheduled.reasons).join(", ")}.`,
        );
      }
    }

    return explanation;
  }
}