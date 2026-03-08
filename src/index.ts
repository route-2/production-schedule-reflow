import fs from "fs";
import path from "path";
import { ReflowService } from "./reflow/reflow.service";
import { computeOptimizationMetrics } from "./reflow/optimizer";
import { InputDocuments, WorkOrderChange } from "./reflow/types";
import {
  printChanges,
  printExecutionTimelines,
  printExplanation,
  printHeader,
  printUpdatedSchedule,
} from "./utils/logging";

function loadScenario(fileName: string): InputDocuments {
  const filePath = path.resolve(process.cwd(), "data", fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Scenario file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as InputDocuments;

  validateScenarioShape(parsed, fileName);

  return parsed;
}

function validateScenarioShape(
  input: Partial<InputDocuments>,
  fileName: string,
): asserts input is InputDocuments {
  if (!input.workOrders || !Array.isArray(input.workOrders)) {
    throw new Error(`Invalid scenario "${fileName}": missing workOrders[]`);
  }

  if (!input.workCenters || !Array.isArray(input.workCenters)) {
    throw new Error(`Invalid scenario "${fileName}": missing workCenters[]`);
  }

  if (!input.manufacturingOrders || !Array.isArray(input.manufacturingOrders)) {
    throw new Error(
      `Invalid scenario "${fileName}": missing manufacturingOrders[]`,
    );
  }
}

function printMetrics(
  input: InputDocuments,
  updatedInput: InputDocuments,
  changes: WorkOrderChange[],
): void {
  const metrics = computeOptimizationMetrics(
    input.workCenters,
    updatedInput.workOrders,
    changes,
  );

  printHeader("METRICS");
  console.log(`Total Work Orders: ${changes.length}`);
  console.log(`Moved Work Orders: ${metrics.movedWorkOrdersCount}`);
  console.log(`Unchanged Work Orders: ${metrics.unchangedWorkOrdersCount}`);
  console.log(`Total Delay Minutes: ${metrics.totalDelayMinutes}`);

  printHeader("WORK CENTER METRICS");

  if (metrics.workCenterMetrics.length === 0) {
    console.log("No work center metrics available.");
    return;
  }

  for (const workCenterMetric of metrics.workCenterMetrics) {
    console.log(
      [
        `Work Center: ${workCenterMetric.workCenterName} (${workCenterMetric.workCenterId})`,
        `Scheduled Working Minutes: ${workCenterMetric.scheduledWorkingMinutes}`,
        `Available Shift Minutes: ${workCenterMetric.availableShiftMinutes}`,
        `Maintenance Minutes: ${workCenterMetric.maintenanceMinutes}`,
        `Idle Minutes: ${workCenterMetric.idleMinutes}`,
        `Makespan Minutes: ${workCenterMetric.makespanMinutes}`,
        `Utilization Ratio: ${(workCenterMetric.utilizationRatio * 100).toFixed(2)}%`,
      ].join("\n"),
    );
    console.log("-".repeat(80));
  }
}

function main(): void {
  const scenarioFile = process.argv[2] ?? "scenario-1-delay-cascade.json";

  printHeader(`RUNNING SCENARIO: ${scenarioFile}`);

  const input = loadScenario(scenarioFile);
  const reflowService = new ReflowService();
  const result = reflowService.reflow(input);

  const updatedInput: InputDocuments = {
    ...input,
    workOrders: result.updatedWorkOrders,
  };

  printUpdatedSchedule(updatedInput);
  printChanges(result.changes);
  printExplanation(result.explanation);

  if (result.executionSegmentsByWorkOrderId) {
    printExecutionTimelines(
      result.updatedWorkOrders,
      result.executionSegmentsByWorkOrderId,
    );
  }

  printMetrics(input, updatedInput, result.changes);
}

try {
  main();
} catch (error) {
  printHeader("ERROR");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("Unknown error", error);
  }

  process.exit(1);
}