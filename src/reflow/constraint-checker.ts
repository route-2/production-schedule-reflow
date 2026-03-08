import { DateTime } from "luxon";
import {
  ExecutionSegmentInternal,
  InputDocuments,
  ValidationError,
  ValidationResult,
  WorkCenterDoc,
  WorkOrderDoc,
} from "./types";
import { buildDependencyGraph, detectCycle } from "./graph";
import {
  getCurrentShiftBoundary,
  overlaps,
  parseUtc,
} from "../utils/date-utils";

type ScheduledInterval = {
  workOrderId: string;
  workOrderNumber: string;
  workCenterId: string;
  start: DateTime;
  end: DateTime;
  isMaintenance: boolean;
  dependsOnWorkOrderIds: string[];
};

export class ConstraintChecker {
  validate(
    input: InputDocuments,
    updatedWorkOrders: WorkOrderDoc[],
    executionSegmentsByWorkOrderId: Map<string, ExecutionSegmentInternal[]>,
  ): ValidationResult {
    const errors: ValidationError[] = [];

    const workCenterById = this.indexWorkCenters(input.workCenters);
    const workOrderById = this.indexWorkOrders(updatedWorkOrders);

    errors.push(
      ...this.validateDependenciesExist(updatedWorkOrders, workOrderById),
    );
    errors.push(
      ...this.validateWorkCentersExist(updatedWorkOrders, workCenterById),
    );
    errors.push(...this.validateNoCycles(updatedWorkOrders));
    errors.push(
      ...this.validateDependencyOrdering(updatedWorkOrders, workOrderById),
    );
    errors.push(...this.validateNoWorkCenterOverlaps(updatedWorkOrders));
    errors.push(
      ...this.validateMaintenanceWindows(
        updatedWorkOrders,
        workCenterById,
        executionSegmentsByWorkOrderId,
      ),
    );
    errors.push(
      ...this.validateShiftSegments(
        updatedWorkOrders,
        workCenterById,
        executionSegmentsByWorkOrderId,
      ),
    );

    return {
      isValid: errors.length === 0,
      errors,
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

  private indexWorkOrders(
    workOrders: WorkOrderDoc[],
  ): Map<string, WorkOrderDoc> {
    const map = new Map<string, WorkOrderDoc>();

    for (const workOrder of workOrders) {
      map.set(workOrder.docId, workOrder);
    }

    return map;
  }

  private validateDependenciesExist(
    workOrders: WorkOrderDoc[],
    workOrderById: Map<string, WorkOrderDoc>,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const workOrder of workOrders) {
      for (const parentId of workOrder.data.dependsOnWorkOrderIds ?? []) {
        if (!workOrderById.has(parentId)) {
          errors.push({
            type: "missing-dependency",
            message: `Work order "${workOrder.docId}" depends on missing work order "${parentId}"`,
            workOrderIds: [workOrder.docId, parentId],
          });
        }
      }
    }

    return errors;
  }

  private validateWorkCentersExist(
    workOrders: WorkOrderDoc[],
    workCenterById: Map<string, WorkCenterDoc>,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const workOrder of workOrders) {
      if (!workCenterById.has(workOrder.data.workCenterId)) {
        errors.push({
          type: "missing-work-center",
          message: `Work order "${workOrder.docId}" references missing work center "${workOrder.data.workCenterId}"`,
          workOrderIds: [workOrder.docId],
          workCenterId: workOrder.data.workCenterId,
        });
      }
    }

    return errors;
  }

  private validateNoCycles(workOrders: WorkOrderDoc[]): ValidationError[] {
    try {
      const graph = buildDependencyGraph(workOrders);
      const cycle = detectCycle(graph);

      if (!cycle.hasCycle) {
        return [];
      }

      return [
        {
          type: "cyclic-dependency",
          message: `Cyclic dependency detected: ${cycle.cyclePath.join(" -> ")}`,
          workOrderIds: cycle.cyclePath,
        },
      ];
    } catch (error) {
      return [
        {
          type: "missing-dependency",
          message:
            error instanceof Error
              ? error.message
              : "Unknown dependency graph validation error",
        },
      ];
    }
  }

  private validateDependencyOrdering(
    workOrders: WorkOrderDoc[],
    workOrderById: Map<string, WorkOrderDoc>,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const workOrder of workOrders) {
      const childStart = parseUtc(workOrder.data.startDate);

      for (const parentId of workOrder.data.dependsOnWorkOrderIds ?? []) {
        const parent = workOrderById.get(parentId);

        if (!parent) {
          continue;
        }

        const parentEnd = parseUtc(parent.data.endDate);

        if (childStart < parentEnd) {
          errors.push({
            type: "dependency-violation",
            message: `Dependency violation: work order "${workOrder.docId}" starts at ${workOrder.data.startDate} before parent "${parentId}" ends at ${parent.data.endDate}`,
            workOrderIds: [parentId, workOrder.docId],
          });
        }
      }
    }

    return errors;
  }

  private validateNoWorkCenterOverlaps(
    workOrders: WorkOrderDoc[],
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const intervalsByWorkCenterId = new Map<string, ScheduledInterval[]>();

    for (const workOrder of workOrders) {
      const interval: ScheduledInterval = {
        workOrderId: workOrder.docId,
        workOrderNumber: workOrder.data.workOrderNumber,
        workCenterId: workOrder.data.workCenterId,
        start: parseUtc(workOrder.data.startDate),
        end: parseUtc(workOrder.data.endDate),
        isMaintenance: workOrder.data.isMaintenance,
        dependsOnWorkOrderIds: [...(workOrder.data.dependsOnWorkOrderIds ?? [])],
      };

      const existing =
        intervalsByWorkCenterId.get(workOrder.data.workCenterId) ?? [];
      existing.push(interval);
      intervalsByWorkCenterId.set(workOrder.data.workCenterId, existing);
    }

    for (const [workCenterId, intervals] of intervalsByWorkCenterId.entries()) {
      intervals.sort((a, b) => a.start.toMillis() - b.start.toMillis());

      for (let i = 1; i < intervals.length; i += 1) {
        const previous = intervals[i - 1];
        const current = intervals[i];

        if (overlaps(previous.start, previous.end, current.start, current.end)) {
          errors.push({
            type: "overlap",
            message: `Overlap on work center "${workCenterId}": "${previous.workOrderId}" (${previous.start.toISO()} -> ${previous.end.toISO()}) overlaps "${current.workOrderId}" (${current.start.toISO()} -> ${current.end.toISO()})`,
            workOrderIds: [previous.workOrderId, current.workOrderId],
            workCenterId,
          });
        }
      }
    }

    return errors;
  }

  private validateMaintenanceWindows(
    workOrders: WorkOrderDoc[],
    workCenterById: Map<string, WorkCenterDoc>,
    executionSegmentsByWorkOrderId: Map<string, ExecutionSegmentInternal[]>,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const workOrder of workOrders) {
      if (workOrder.data.isMaintenance) {
        continue;
      }

      const workCenter = workCenterById.get(workOrder.data.workCenterId);
      if (!workCenter) {
        continue;
      }

      const segments = executionSegmentsByWorkOrderId.get(workOrder.docId) ?? [];

      for (const segment of segments) {
        for (const window of workCenter.data.maintenanceWindows) {
          const maintenanceStart = parseUtc(window.startDate);
          const maintenanceEnd = parseUtc(window.endDate);

          if (
            overlaps(segment.start, segment.end, maintenanceStart, maintenanceEnd)
          ) {
            errors.push({
              type: "maintenance-violation",
              message: `Maintenance violation: execution segment of work order "${workOrder.docId}" overlaps maintenance window ${window.startDate} -> ${window.endDate} on work center "${workCenter.docId}"`,
              workOrderIds: [workOrder.docId],
              workCenterId: workCenter.docId,
            });
          }
        }
      }
    }

    return errors;
  }

  private validateShiftSegments(
    workOrders: WorkOrderDoc[],
    workCenterById: Map<string, WorkCenterDoc>,
    executionSegmentsByWorkOrderId: Map<string, ExecutionSegmentInternal[]>,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const workOrder of workOrders) {
      const workCenter = workCenterById.get(workOrder.data.workCenterId);
      if (!workCenter) {
        continue;
      }

      const segments = executionSegmentsByWorkOrderId.get(workOrder.docId) ?? [];

      if (segments.length === 0) {
        errors.push({
          type: "no-valid-slot",
          message: `No execution segments recorded for work order "${workOrder.docId}"`,
          workOrderIds: [workOrder.docId],
          workCenterId: workCenter.docId,
        });
        continue;
      }

      for (const segment of segments) {
        if (segment.end <= segment.start) {
          errors.push({
            type: "no-valid-slot",
            message: `Invalid execution segment for work order "${workOrder.docId}": end must be after start`,
            workOrderIds: [workOrder.docId],
            workCenterId: workCenter.docId,
          });
          continue;
        }

        const startShift = getCurrentShiftBoundary(
          segment.start,
          workCenter.data.shifts,
        );
        const endShift = getCurrentShiftBoundary(
          segment.end.minus({ minutes: 1 }),
          workCenter.data.shifts,
        );

        if (!startShift || !endShift) {
          errors.push({
            type: "shift-violation",
            message: `Shift violation: execution segment of work order "${workOrder.docId}" falls outside shift hours`,
            workOrderIds: [workOrder.docId],
            workCenterId: workCenter.docId,
          });
        }
      }
    }

    return errors;
  }
}