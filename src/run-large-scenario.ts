import fs from "fs";
import path from "path";
import { ReflowService } from "./reflow/reflow.service";
import { InputDocuments } from "./reflow/types";
import { computeOptimizationMetrics } from "./reflow/optimizer";

function loadScenario(filePath: string): InputDocuments {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as InputDocuments;
}

function main(): void {
  const inputPath = path.resolve(
    process.cwd(),
    "data/generated/generated-large-scenario.json",
  );
  const outputPath = path.resolve(
    process.cwd(),
    "output/generated-large-scenario-result.json",
  );

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input scenario not found: ${inputPath}`);
  }

  const input = loadScenario(inputPath);

  const startedAt = Date.now();
  const result = new ReflowService().reflow(input);
  const finishedAt = Date.now();

  const updatedInput: InputDocuments = {
    ...input,
    workOrders: result.updatedWorkOrders,
  };

  const metrics = computeOptimizationMetrics(
    input.workCenters,
    updatedInput.workOrders,
    result.changes,
  );

  const output = {
    metadata: {
      inputPath,
      generatedAt: new Date().toISOString(),
      durationMs: finishedAt - startedAt,
      workCenters: input.workCenters.length,
      manufacturingOrders: input.manufacturingOrders.length,
      workOrders: input.workOrders.length,
    },
    metrics,
    result: {
      updatedWorkOrders: result.updatedWorkOrders,
      changes: result.changes,
      explanation: result.explanation,
    },
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");

  console.log(`Saved result to ${outputPath}`);
  console.log(`Runtime: ${finishedAt - startedAt} ms`);
  console.log(`Work orders processed: ${input.workOrders.length}`);
  console.log(`Moved work orders: ${metrics.movedWorkOrdersCount}`);
  console.log(`Total delay minutes: ${metrics.totalDelayMinutes}`);
}

main();