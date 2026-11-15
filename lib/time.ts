// Display time zone. Storage and session math stay in UTC / America/New_York (AGENTS.md §3b-5, UX-87);
// this module only changes how instants are shown and how typed wall-clock times are read.
// The owner reads charts in Central Time (docs/12 LV-03). Until the /tune preference exists (UX-86),
// every screen uses this one constant.
export const DISPLAY_TIME_ZONE = "America/Chicago";

const zoneParts = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPLAY_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function wallClock(instant: number) {
  const parts = Object.fromEntries(zoneParts.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second),
  };
}

/** Milliseconds the display zone is ahead of UTC at this instant (CST = -6 h, CDT = -5 h). */
function zoneOffset(instant: number) {
  const w = wallClock(instant);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(instant / 1000) * 1000;
}

/** `YYYY-MM-DDTHH:mm` as shown in the display zone, for `<input type="datetime-local">`. */
export function toZonedInput(date: Date) {
  const w = wallClock(date.getTime());
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** Reads a `datetime-local` value as wall-clock time in the display zone, whatever zone the device is in. */
export function fromZonedInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return new Date(Number.NaN);
  const [, y, mo, d, h, mi, s] = match;
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  const first = asUtc - zoneOffset(asUtc);
  const second = asUtc - zoneOffset(first);
  return new Date(second);
}

export const zoneLabel = (date: Date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIME_ZONE, timeZoneName: "short" })
    .formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "CT";

export const dateTimeFormat = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIME_ZONE, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
export const shortTimeFormat = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
const axisTime = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
const axisDay = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIME_ZONE, month: "short", day: "numeric" });
const crosshairTime = new Intl.DateTimeFormat("en-US", { timeZone: DISPLAY_TIME_ZONE, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });

/**
 * lightweight-charts has no time zones and labels UTCTimestamp values in UTC.
 * These formatters relabel the axis and crosshair in the display zone without shifting the data.
 * Tick mark type: 0 Year, 1 Month, 2 DayOfMonth, 3 Time, 4 TimeWithSeconds.
 */
export function chartTickLabel(seconds: number, tickMarkType: number) {
  const date = new Date(seconds * 1000);
  if (tickMarkType <= 1) return axisDay.format(date);
  // The library places day ticks on UTC midnight (18:00 or 19:00 CT), so only call it a new day at CT midnight.
  const time = axisTime.format(date);
  return tickMarkType === 2 && (time === "00:00" || time === "24:00") ? axisDay.format(date) : time;
}

export function chartCrosshairLabel(seconds: number) {
  return crosshairTime.format(new Date(seconds * 1000));
}
