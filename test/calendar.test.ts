import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  buildWorkCenterBlockedIntervals,
  scheduleWithinCalendar,
} from "../src/reflow/calendar";
import { WorkCenterDoc, WorkOrderDoc } from "../src/reflow/types";
import { parseUtc, toUtcIso } from "../src/utils/date-utils";

function makeWorkCenter(
  maintenanceWindows: Array<{ startDate: string; endDate: string; reason?: string }> = [],
): WorkCenterDoc {
  return {
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
      maintenanceWindows,
    },
  };
}

describe("calendar scheduling", () => {
  it("pauses at shift boundary and resumes next shift", () => {
    const workCenter = makeWorkCenter();

    const result = scheduleWithinCalendar(
      parseUtc("2026-03-03T16:00:00Z"),
      120,
      workCenter,
      [],
    );

    expect(toUtcIso(result.start)).toBe("2026-03-03T16:00:00Z");
    expect(toUtcIso(result.end)).toBe("2026-03-04T09:00:00Z");
    expect(result.appliedReasons.has("shift-boundary")).toBe(true);
  });

  it("pauses for maintenance and resumes after it", () => {
    const workCenter = makeWorkCenter([
      {
        startDate: "2026-03-04T10:00:00Z",
        endDate: "2026-03-04T12:00:00Z",
        reason: "Planned maintenance",
      },
    ]);

    const blocked = buildWorkCenterBlockedIntervals(workCenter, []);

    const result = scheduleWithinCalendar(
      parseUtc("2026-03-04T09:00:00Z"),
      240,
      workCenter,
      blocked,
    );

    expect(toUtcIso(result.start)).toBe("2026-03-04T09:00:00Z");
    expect(toUtcIso(result.end)).toBe("2026-03-04T15:00:00Z");
    expect(result.appliedReasons.has("maintenance-window")).toBe(true);
  });

  it("shifts start forward when another work order already blocks the machine", () => {
    const workCenter = makeWorkCenter();

    const blocked = [
      {
        start: parseUtc("2026-03-05T08:00:00Z"),
        end: parseUtc("2026-03-05T10:00:00Z"),
        reason: "scheduled-work-order" as const,
        sourceId: "wo-existing",
      },
    ];

    const result = scheduleWithinCalendar(
      parseUtc("2026-03-05T09:00:00Z"),
      60,
      workCenter,
      blocked,
    );

    expect(toUtcIso(result.start)).toBe("2026-03-05T10:00:00Z");
    expect(toUtcIso(result.end)).toBe("2026-03-05T11:00:00Z");
  });
});