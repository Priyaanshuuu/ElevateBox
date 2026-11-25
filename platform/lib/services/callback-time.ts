export interface ResolveCallbackTimeInput {
  timezone: string;
  requestText?: string;
  scheduledAt?: string;
  defaultHour?: number;
  now?: Date;
}

export type ResolveCallbackTimeResult =
  | { status: "scheduled"; scheduledAt: Date }
  | { status: "needs-clarification"; reason: string };

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`Invalid callback timezone: ${timezone}`);
  }
}

function localParts(value: Date, timezone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number.parseInt(get("year"), 10),
    month: Number.parseInt(get("month"), 10),
    day: Number.parseInt(get("day"), 10),
    weekday: weekdayNumber(get("weekday")),
  };
}

function weekdayNumber(value: string): number {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const index = days.findIndex((day) => value.toLowerCase().startsWith(day.slice(0, 3)));
  return index < 0 ? 0 : index;
}

function addDays(value: LocalDateParts, days: number): LocalDateParts {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

function timezoneOffsetMs(utcGuess: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(utcGuess);
  const get = (type: string) => Number.parseInt(parts.find((part) => part.type === type)?.value ?? "0", 10);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - utcGuess.getTime();
}

function zonedDateTimeToUtc(
  date: LocalDateParts,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const localAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const firstOffset = timezoneOffsetMs(new Date(localAsUtc), timezone);
  const secondOffset = timezoneOffsetMs(new Date(localAsUtc - firstOffset), timezone);
  return new Date(localAsUtc - secondOffset);
}

function requestedDate(text: string, current: LocalDateParts): LocalDateParts | null {
  if (/\btomorrow\b|कल|రేపు/i.test(text)) return addDays(current, 1);
  if (/\btoday\b|आज|నేడు/i.test(text)) return current;

  const weekdayPatterns: Array<[RegExp, number]> = [
    [/\bmonday\b|सोमवार|సోమవారం/i, 1],
    [/\btuesday\b|मंगलवार|మంగళవారం/i, 2],
    [/\bwednesday\b|बुधवार|బుధవారం/i, 3],
    [/\bthursday\b|गुरुवार|గురువారం/i, 4],
    [/\bfriday\b|शुक्रवार|శుక్రవారం/i, 5],
    [/\bsaturday\b|शनिवार|శనివారం/i, 6],
    [/\bsunday\b|रविवार|ఆదివారం/i, 0],
  ];
  for (const [pattern, target] of weekdayPatterns) {
    if (pattern.test(text)) {
      const daysUntil = (target - current.weekday + 7) % 7 || 7;
      return addDays(current, daysUntil);
    }
  }

  if (/\d{1,2}(?::\d{2})?\s*(?:am|pm|बजे|बजकर|गंट|గంట)/i.test(text)) {
    return current;
  }
  return null;
}

function requestedTime(text: string, defaultHour: number): { hour: number; minute: number } {
  const english = text.match(/(?:at\s+|around\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (english?.[1] && english[3]) {
    const rawHour = Number.parseInt(english[1], 10);
    const minute = english[2] ? Number.parseInt(english[2], 10) : 0;
    if (rawHour >= 1 && rawHour <= 12 && minute <= 59) {
      return {
        hour: (rawHour % 12) + (english[3].toLowerCase() === "pm" ? 12 : 0),
        minute,
      };
    }
  }

  const indic = text.match(
    /(सुबह|शाम|रात|उदयం|సాయంత్రం|రాత్రి)?\s*(\d{1,2})(?::(\d{2}))?\s*(बजे|बजकर|గంటలు|గంట)/i,
  );
  if (indic?.[2]) {
    const rawHour = Number.parseInt(indic[2], 10);
    const minute = indic[3] ? Number.parseInt(indic[3], 10) : 0;
    const marker = (indic[1] ?? "").toLowerCase();
    if (rawHour >= 1 && rawHour <= 12 && minute <= 59) {
      const isEvening = /शाम|सायं|సాయంత్రం|రాత్రి/i.test(marker);
      const isMorning = /सुबह|उदयం|ఉదయం/i.test(marker);
      if (isEvening && rawHour < 12) return { hour: rawHour + 12, minute };
      if (isMorning && rawHour === 12) return { hour: 0, minute };
      return { hour: rawHour, minute };
    }
    if (rawHour <= 23 && minute <= 59) return { hour: rawHour, minute };
  }

  return { hour: defaultHour, minute: 0 };
}

export function resolveCallbackTime(input: ResolveCallbackTimeInput): ResolveCallbackTimeResult {
  const now = input.now ?? new Date();
  validateTimezone(input.timezone);
  const defaultHour = input.defaultHour ?? 10;
  if (!Number.isInteger(defaultHour) || defaultHour < 0 || defaultHour > 23) {
    throw new Error("CALLBACK_DEFAULT_HOUR must be an integer from 0 to 23.");
  }

  if (input.scheduledAt) {
    const parsed = new Date(input.scheduledAt);
    if (
      Number.isNaN(parsed.getTime()) ||
      !/(?:Z|[+-]\d{2}:?\d{2})$/.test(input.scheduledAt)
    ) {
      throw new Error("scheduled_at must be an ISO-8601 timestamp with an explicit timezone.");
    }
    if (parsed.getTime() <= now.getTime()) {
      return { status: "needs-clarification", reason: "The requested callback time is in the past." };
    }
    return { status: "scheduled", scheduledAt: parsed };
  }

  const text = input.requestText?.trim();
  if (!text) {
    return {
      status: "needs-clarification",
      reason: "Ask for a specific future day and time for the callback.",
    };
  }

  const current = localParts(now, input.timezone);
  const date = requestedDate(text.toLowerCase(), current);
  if (!date) {
    return {
      status: "needs-clarification",
      reason: "Ask for a specific future day and time for the callback.",
    };
  }

  const { hour, minute } = requestedTime(text.toLowerCase(), defaultHour);
  let scheduledAt = zonedDateTimeToUtc(date, hour, minute, input.timezone);
  if (scheduledAt.getTime() <= now.getTime()) {
    scheduledAt = zonedDateTimeToUtc(addDays(date, 1), hour, minute, input.timezone);
  }
  if (scheduledAt.getTime() <= now.getTime()) {
    return { status: "needs-clarification", reason: "The requested callback time is in the past." };
  }

  return { status: "scheduled", scheduledAt };
}
