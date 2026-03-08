import {
  ExecutionSegmentInternal,
  InputDocuments,
  WorkOrderChange,
  WorkOrderDoc,
} from "../reflow/types";
import { toUtcIso } from "./date-utils";

export function printHeader(title: string): void {
  console.log("\n" + "=".repeat(80));
  console.log(title);
  console.log("=".repeat(80));
}

export function printChanges(changes: WorkOrderChange[]): void {
  printHeader("CHANGES");

  if (changes.length === 0) {
    console.log("No work orders found.");
    return;
  }

  for (const change of changes) {
    console.log(
      [
        `WO: ${change.workOrderNumber} (${change.workOrderId})`,
        `Old: ${change.oldStartDate} -> ${change.oldEndDate}`,
        `New: ${change.newStartDate} -> ${change.newEndDate}`,
        `Delta Start: ${change.deltaStartMinutes} min`,
        `Delta End: ${change.deltaEndMinutes} min`,
        `Reasons: ${change.reasons.join(", ")}`,
        `Explanation: ${change.explanation}`,
      ].join("\n"),
    );
    console.log("-".repeat(80));
  }
}

export function printUpdatedSchedule(input: InputDocuments): void {
  printHeader("UPDATED WORK ORDERS");

  const sorted = [...input.workOrders].sort((a, b) => {
    const wcCompare = a.data.workCenterId.localeCompare(b.data.workCenterId);
    if (wcCompare !== 0) {
      return wcCompare;
    }

    return a.data.startDate.localeCompare(b.data.startDate);
  });

  for (const workOrder of sorted) {
    console.log(
      [
        `WO: ${workOrder.data.workOrderNumber}`,
        `Work Center: ${workOrder.data.workCenterId}`,
        `Start: ${workOrder.data.startDate}`,
        `End: ${workOrder.data.endDate}`,
        `Duration: ${workOrder.data.durationMinutes} min`,
        `Setup Time: ${workOrder.data.setupTimeMinutes ?? 0} min`,
        `Is Maintenance: ${workOrder.data.isMaintenance}`,
        `Depends On: ${
          workOrder.data.dependsOnWorkOrderIds.length > 0
            ? workOrder.data.dependsOnWorkOrderIds.join(", ")
            : "none"
        }`,
      ].join("\n"),
    );
    console.log("-".repeat(80));
  }
}

export function printExplanation(explanation: string[]): void {
  printHeader("EXPLANATION");

  for (const line of explanation) {
    console.log(`- ${line}`);
  }
}

export function printExecutionSegments(
  workOrders: WorkOrderDoc[],
  executionSegmentsByWorkOrderId: Map<string, ExecutionSegmentInternal[]>,
): void {
  printHeader("EXECUTION SEGMENTS");

  const sorted = [...workOrders].sort((a, b) =>
    a.data.workOrderNumber.localeCompare(b.data.workOrderNumber),
  );

  for (const workOrder of sorted) {
    const segments =
      executionSegmentsByWorkOrderId.get(workOrder.docId)?.slice().sort(
        (a, b) => a.start.toMillis() - b.start.toMillis(),
      ) ?? [];

    console.log(`WO: ${workOrder.data.workOrderNumber} (${workOrder.docId})`);

    if (segments.length === 0) {
      console.log("  No execution segments recorded.");
      console.log("-".repeat(80));
      continue;
    }

    for (const segment of segments) {
      console.log(
        `  ACTIVE  ${toUtcIso(segment.start)} -> ${toUtcIso(segment.end)}`,
      );
    }

    console.log("-".repeat(80));
  }
}

export function printExecutionTimelines(
  workOrders: WorkOrderDoc[],
  executionSegmentsByWorkOrderId: Map<string, ExecutionSegmentInternal[]>,
): void {
  printHeader("EXECUTION TIMELINES");

  const sorted = [...workOrders].sort((a, b) =>
    a.data.workOrderNumber.localeCompare(b.data.workOrderNumber),
  );

  for (const workOrder of sorted) {
    const segments =
      executionSegmentsByWorkOrderId.get(workOrder.docId)?.slice().sort(
        (a, b) => a.start.toMillis() - b.start.toMillis(),
      ) ?? [];

    console.log(`WO: ${workOrder.data.workOrderNumber} (${workOrder.docId})`);

    if (segments.length === 0) {
      console.log("  No execution segments recorded.");
      console.log("-".repeat(80));
      continue;
    }

    for (let i = 0; i < segments.length; i += 1) {
      const current = segments[i];

      console.log(
        `  ACTIVE  ${toUtcIso(current.start)} -> ${toUtcIso(current.end)}`,
      );

      const next = segments[i + 1];
      if (next && current.end < next.start) {
        console.log(
          `  PAUSED  ${toUtcIso(current.end)} -> ${toUtcIso(next.start)}`,
        );
      }
    }

    console.log("-".repeat(80));
  }
}