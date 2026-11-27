// Display time zone. Storage stays UTC and session math stays America/New_York (lib/session.ts);
// this module only changes how instants are shown and how typed wall-clock times are read.
// The zone is a preference (UX-86). The owner reads charts in Central Time (docs/12 LV-03),
// so that is the default until they pick another one on the Tune screen.

export const DEFAULT_TIME_ZONE = "America/Chicago";

export const TIME_ZONE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "America/Chicago", label: "Central (CT)" },
  { id: "America/New_York", label: "Exchange (ET)" },
  { id: "Europe/London", label: "London" },
  { id: "UTC", label: "UTC" },
];

interface ZoneFormats {
  parts: Intl.DateTimeFormat;
  listTime: Intl.DateTimeFormat;
  detailTime: Intl.DateTimeFormat;
  dateTime: Intl.DateTimeFormat;
  axisTime: Intl.DateTimeFormat;
  axisDay: Intl.DateTimeFormat;
  crosshair: Intl.DateTimeFormat;
  zoneName: Intl.DateTimeFormat;
}

const cache = new Map<string, ZoneFormats>();

function formats(zone: string): ZoneFormats {
  let found = cache.get(zone);
  if (!found) {
    const base = { timeZone: zone } as const;
    found = {
      parts: new Intl.DateTimeFormat("en-US", { ...base, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      listTime: new Intl.DateTimeFormat("en-US", { ...base, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }),
      detailTime: new Intl.DateTimeFormat("en-US", { ...base, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      dateTime: new Intl.DateTimeFormat("en-US", { ...base, hourCycle: "h23", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      axisTime: new Intl.DateTimeFormat("en-US", { ...base, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }),
      axisDay: new Intl.DateTimeFormat("en-US", { ...base, month: "short", day: "numeric" }),
      crosshair: new Intl.DateTimeFormat("en-US", { ...base, hourCycle: "h23", weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      zoneName: new Intl.DateTimeFormat("en-US", { ...base, timeZoneName: "short" }),
    };
    cache.set(zone, found);
  }
  return found;
}

function wallClock(instant: number, zone: string) {
  const parts = Object.fromEntries(formats(zone).parts.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second),
  };
}

/** Milliseconds the zone is ahead of UTC at this instant (CST = −6 h, CDT = −5 h). */
function zoneOffset(instant: number, zone: string) {
  const w = wallClock(instant, zone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(instant / 1000) * 1000;
}

/** `YYYY-MM-DDTHH:mm` as shown in the zone, for `<input type="datetime-local">`. */
export function toZonedInput(date: Date, zone = DEFAULT_TIME_ZONE) {
  const w = wallClock(date.getTime(), zone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

interface WallTime { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** True when `instant` reads back in the zone as exactly the wall-clock time `wanted`. */
function readsBackAs(instant: number, zone: string, wanted: WallTime) {
  const w = wallClock(instant, zone);
  return w.year === wanted.year && w.month === wanted.month && w.day === wanted.day
    && w.hour === wanted.hour && w.minute === wanted.minute && w.second === wanted.second;
}

/**
 * Reads a `datetime-local` value as wall-clock time in the zone, whatever zone the device is in.
 * A wall time in the spring-forward gap never happens, and one in the fall-back overlap happens
 * twice; neither has a single honest reading, so both return an Invalid Date — the same signal
 * as a malformed value, which every caller already turns into a validation error — instead of
 * silently shifting to a neighbouring time the user never typed (T-01).
 */
export function fromZonedInput(value: string, zone = DEFAULT_TIME_ZONE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return new Date(Number.NaN);
  const [, y, mo, d, h, mi, s] = match;
  const wanted: WallTime = {
    year: Number(y), month: Number(mo), day: Number(d),
    hour: Number(h), minute: Number(mi), second: Number(s ?? 0),
  };
  const asUtc = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute, wanted.second);
  const first = asUtc - zoneOffset(asUtc, zone);
  const second = asUtc - zoneOffset(first, zone);
  // Gap: the computed instant reads back as a different wall time, so the typed one never occurs.
  if (!readsBackAs(second, zone, wanted)) return new Date(Number.NaN);
  // Overlap: an offset from the other side of a nearby transition gives a different instant that
  // reads back as the same wall time, so the typed time occurs twice and cannot be picked silently.
  const baseOffset = zoneOffset(second, zone);
  const hourMs = 3_600_000;
  for (const probe of [second - 3 * hourMs, second - 2 * hourMs, second - hourMs, second + hourMs, second + 2 * hourMs, second + 3 * hourMs]) {
    const offset = zoneOffset(probe, zone);
    if (offset === baseOffset) continue;
    const other = asUtc - offset;
    if (other !== second && readsBackAs(other, zone, wanted)) return new Date(Number.NaN);
  }
  return new Date(second);
}

/** Short zone name at that instant: `CST`, `CDT`, `EST`, `GMT`… */
export function zoneLabel(instant: number | Date, zone = DEFAULT_TIME_ZONE) {
  const date = typeof instant === "number" ? new Date(instant) : instant;
  return formats(zone).zoneName.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? zone;
}

/** `09:48` — lists (docs/08 §13). */
export function formatListTime(instant: number | string, zone = DEFAULT_TIME_ZONE) {
  return formats(zone).listTime.format(new Date(instant));
}

/** `09:48:12 CST` — detail views, always with the zone. */
export function formatDetailTime(instant: number | string, zone = DEFAULT_TIME_ZONE) {
  const date = new Date(instant);
  return `${formats(zone).detailTime.format(date)} ${zoneLabel(date, zone)}`;
}

/** `Nov 13, 09:48 CST` — exports and headers; every exported time carries its zone (UX-75). */
export function formatDateTime(instant: number | string, zone = DEFAULT_TIME_ZONE) {
  const date = new Date(instant);
  return `${formats(zone).dateTime.format(date)} ${zoneLabel(date, zone)}`;
}

/**
 * lightweight-charts has no time zones and labels UTCTimestamp values in UTC.
 * These formatters relabel the axis and crosshair in the display zone without shifting the data.
 * Tick mark type: 0 Year, 1 Month, 2 DayOfMonth, 3 Time, 4 TimeWithSeconds.
 */
export function chartTickLabel(seconds: number, tickMarkType: number, zone = DEFAULT_TIME_ZONE) {
  const date = new Date(seconds * 1000);
  const f = formats(zone);
  if (tickMarkType <= 1) return f.axisDay.format(date);
  // The library places day ticks on UTC midnight, so only call it a new day at midnight in the display zone.
  const time = f.axisTime.format(date);
  return tickMarkType === 2 && time === "00:00" ? f.axisDay.format(date) : time;
}

export function chartCrosshairLabel(seconds: number, zone = DEFAULT_TIME_ZONE) {
  const date = new Date(seconds * 1000);
  return `${formats(zone).crosshair.format(date)} ${zoneLabel(date, zone)}`;
}
