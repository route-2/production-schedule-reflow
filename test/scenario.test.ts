import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ReflowService } from "../src/reflow/reflow.service";
import { ChangeReason, InputDocuments } from "../src/reflow/types";

type ScenarioExpectation = {
  shouldThrow: boolean;
  errorContains?: string;
  workOrderDates?: Record<
    string,
    {
      startDate: string;
      endDate: string;
    }
  >;
  reasonChecks?: Record<string, ChangeReason[]>;
};

type ScenarioRecord = {
  name: string;
  input: InputDocuments;
  expected: ScenarioExpectation;
};

type ScenarioFile = {
  scenarios: ScenarioRecord[];
};

function loadScenarioTable(): ScenarioFile {
  const filePath = path.resolve(process.cwd(), "data", "test-scenarios.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as ScenarioFile;
}

describe("table-driven reflow scenarios", () => {
  const scenarioFile = loadScenarioTable();

  for (const scenario of scenarioFile.scenarios) {
    it(scenario.name, () => {
      const service = new ReflowService();

      if (scenario.expected.shouldThrow) {
        expect(() => service.reflow(scenario.input)).toThrow(
          scenario.expected.errorContains
            ? new RegExp(scenario.expected.errorContains)
            : undefined,
        );
        return;
      }

      const result = service.reflow(scenario.input);

      if (scenario.expected.workOrderDates) {
        for (const [workOrderId, expectedDates] of Object.entries(
          scenario.expected.workOrderDates,
        )) {
          const actual = result.updatedWorkOrders.find(
            (workOrder) => workOrder.docId === workOrderId,
          );

          expect(actual, `Missing work order ${workOrderId}`).toBeDefined();
          expect(actual?.data.startDate).toBe(expectedDates.startDate);
          expect(actual?.data.endDate).toBe(expectedDates.endDate);
        }
      }

      if (scenario.expected.reasonChecks) {
        for (const [workOrderId, expectedReasons] of Object.entries(
          scenario.expected.reasonChecks,
        )) {
          const actualChange = result.changes.find(
            (change) => change.workOrderId === workOrderId,
          );

          expect(actualChange, `Missing change for ${workOrderId}`).toBeDefined();

          for (const expectedReason of expectedReasons) {
            expect(actualChange?.reasons).toContain(expectedReason);
          }
        }
      }
    });
  }
});