import { createScheduledCallback } from "../../../platform/lib/services/callback.service.ts";

export interface ScheduleCallbackInput {
  leadId: string;
  callId?: string;
  requestText: string;
  timezone: string;
  defaultHour: number;
  notes?: string;
}

export type ScheduleCallbackResult =
  | { status: "scheduled"; callbackId: string; scheduledAt: Date }
  | { status: "needs-clarification"; reason: string };

export class CallbackTool {
  async schedule(input: ScheduleCallbackInput): Promise<ScheduleCallbackResult> {
    const scheduledAt = parseCallbackTime(
      input.requestText,
      input.timezone,
      input.defaultHour,
    );
    if (!scheduledAt) {
      return {
        status: "needs-clarification",
        reason: "Ask for a specific future day and time for the callback.",
      };
    }

    const callback = await createScheduledCallback({
      leadId: input.leadId,
      ...(input.callId !== undefined ? { callId: input.callId } : {}),
      scheduledAt,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });

    return {
      status: "scheduled",
      callbackId: callback.id,
      scheduledAt: callback.scheduledAt,
    };
  }
}

function parseCallbackTime(
  requestText: string,
  timezone: string,
  defaultHour: number,
): Date | null {
  if (!Number.isInteger(defaultHour) || defaultHour < 0 || defaultHour > 23) {
    throw new Error("CALLBACK_DEFAULT_HOUR must be an integer from 0 to 23.");
  }

  assertValidTimezone(timezone);
  const text = requestText.toLowerCase();
  const now = new Date();
  const localNow = getLocalParts(now, timezone);
  const date = getRequestedDate(text, localNow);
  if (!date) {
    return null;
  }

  const time = getRequestedTime(text);
  const hour = time?.hour ?? defaultHour;
  const minute = time?.minute ?? 0;
  let candidate = zonedDateTimeToUtc(date.year, date.month, date.day, hour, minute, timezone);
  if (candidate.getTime() <= now.getTime() && !text.includes("today") && !text.includes("tomorrow")) {
    const nextDate = addDays(date, 1);
    candidate = zonedDateTimeToUtc(nextDate.year, nextDate.month, nextDate.day, hour, minute, timezone);
  }

  return candidate.getTime() > now.getTime() ? candidate : null;
}

function getRequestedDate(
  text: string,
  current: LocalDateParts,
): LocalDateParts | null {
  if (text.includes("tomorrow")) {
    return addDays(current, 1);
  }

  const weekdayMatch = text.match(/(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
  if (weekdayMatch?.[1]) {
    const target = weekdayNumber(weekdayMatch[1]);
    const daysUntil = (target - current.weekday + 7) % 7 || 7;
    return addDays(current, daysUntil);
  }

  if (text.includes("today")) {
    return current;
  }

  // A clock time without a date means the next occurrence in the business timezone.
  if (/(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(text)) {
    return current;
  }

  return null;
}

function getRequestedTime(text: string): { hour: number; minute: number } | null {
  const match = text.match(/(?:at\s+|around\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match?.[1] || !match[3]) {
    return null;
  }

  const rawHour = Number.parseInt(match[1], 10);
  const minute = match[2] ? Number.parseInt(match[2], 10) : 0;
  if (rawHour < 1 || rawHour > 12 || minute > 59) {
    return null;
  }

  const hour = rawHour % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0);
  return { hour, minute };
}

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
};

function getLocalParts(value: Date, timezone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number.parseInt(get("year"), 10),
    month: Number.parseInt(get("month"), 10),
    day: Number.parseInt(get("day"), 10),
    weekday: weekdayNumber(get("weekday")),
    hour: Number.parseInt(get("hour"), 10),
    minute: Number.parseInt(get("minute"), 10),
  };
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = getLocalParts(utcGuess, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const offset = asUtc - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offset);
}

function addDays(value: LocalDateParts, days: number): LocalDateParts {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    hour: 0,
    minute: 0,
  };
}

function weekdayNumber(value: string): number {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const index = days.findIndex((day) => value.toLowerCase().startsWith(day.slice(0, 3)));
  if (index < 0) {
    throw new Error(`Invalid weekday: ${value}`);
  }
  return index;
}

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`Invalid callback timezone: ${timezone}`);
  }
}
