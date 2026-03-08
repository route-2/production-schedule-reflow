import { DateTime } from "luxon";
import { Shift } from "../reflow/types";

export const UTC_ZONE = "utc";

export function parseUtc(iso: string): DateTime {
  const dt = DateTime.fromISO(iso, { zone: UTC_ZONE });

  if (!dt.isValid) {
    throw new Error(`Invalid ISO date: "${iso}"`);
  }

  return dt;
}

export function toUtcIso(dateTime: DateTime): string {
  return dateTime.toUTC().toISO({
    suppressMilliseconds: true,
    includeOffset: true,
  }) as string;
}

export function maxDate(a: DateTime, b: DateTime): DateTime {
  return a.toMillis() >= b.toMillis() ? a : b;
}

export function minDate(a: DateTime, b: DateTime): DateTime {
  return a.toMillis() <= b.toMillis() ? a : b;
}

export function diffMinutes(later: DateTime, earlier: DateTime): number {
  return Math.round(later.diff(earlier, "minutes").minutes);
}

export function overlaps(
  aStart: DateTime,
  aEnd: DateTime,
  bStart: DateTime,
  bEnd: DateTime,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function clampStartToHour(dateTime: DateTime, hour: number): DateTime {
  return dateTime.set({
    hour,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
}

export function startOfUtcDay(dateTime: DateTime): DateTime {
  return dateTime.toUTC().startOf("day");
}

export function addDays(dateTime: DateTime, days: number): DateTime {
  return dateTime.plus({ days });
}

export function getShiftForDate(
  dateTime: DateTime,
  shifts: Shift[],
): { start: DateTime; end: DateTime } | null {
  const utc = dateTime.toUTC();
  const dayShift = shifts.find((shift) => shift.dayOfWeek === utc.weekday % 7);

  if (!dayShift) {
    return null;
  }

  const start = utc.set({
    hour: dayShift.startHour,
    minute: 0,
    second: 0,
    millisecond: 0,
  });

  const end = utc.set({
    hour: dayShift.endHour,
    minute: 0,
    second: 0,
    millisecond: 0,
  });

  return { start, end };
}

export function isWithinShift(dateTime: DateTime, shifts: Shift[]): boolean {
  const shift = getShiftForDate(dateTime, shifts);

  if (!shift) {
    return false;
  }

  return dateTime >= shift.start && dateTime < shift.end;
}

export function nextShiftStart(
  after: DateTime,
  shifts: Shift[],
  maxDaysToScan = 30,
): DateTime {
  const utc = after.toUTC();

  for (let offset = 0; offset <= maxDaysToScan; offset += 1) {
    const currentDay = utc.plus({ days: offset });
    const shift = getShiftForDate(currentDay, shifts);

    if (!shift) {
      continue;
    }

    if (offset === 0) {
      if (utc < shift.start) {
        return shift.start;
      }

      if (utc >= shift.start && utc < shift.end) {
        return utc;
      }
    } else {
      return shift.start;
    }
  }

  throw new Error(
    `No future shift start found within ${maxDaysToScan} days from ${utc.toISO()}`,
  );
}

export function getCurrentShiftBoundary(
  dateTime: DateTime,
  shifts: Shift[],
): { start: DateTime; end: DateTime } | null {
  const shift = getShiftForDate(dateTime, shifts);

  if (!shift) {
    return null;
  }

  if (dateTime >= shift.start && dateTime < shift.end) {
    return shift;
  }

  return null;
}