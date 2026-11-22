// Session math. Always America/New_York, never a fixed offset and never the display zone
// (AGENTS §3b-5, B-20, UX-87).

const NEW_YORK = "America/New_York";

const nyFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK,
  hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const regularHoursFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK,
  hourCycle: "h23",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const REGULAR_HOURS_SYMBOLS = new Set(["MES", "MNQ"]);

function isRegularTradingInstant(instant: number) {
  const parts = Object.fromEntries(
    regularHoursFormat.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  const minutes = (Number(parts.hour) % 24) * 60 + Number(parts.minute);

  switch (parts.weekday) {
    case "Sun":
      return minutes >= 18 * 60;
    case "Mon":
    case "Tue":
    case "Wed":
    case "Thu":
      return minutes < 17 * 60 || minutes >= 18 * 60;
    case "Fri":
      return minutes < 17 * 60;
    default:
      return false;
  }
}

/**
 * Whether the whole bar interval belongs to the regular MES/MNQ Globex window.
 * Other symbols keep clock-time expectations until their own schedule is decided.
 * This deliberately models regular weekly hours only, not holidays or early closes (OD-35).
 */
export function isRegularTradingBarInterval(symbol: string | undefined, openTime: number, barMs: number) {
  if (!Number.isFinite(openTime) || !Number.isFinite(barMs) || barMs <= 0) return false;
  if (!symbol || !REGULAR_HOURS_SYMBOLS.has(symbol.trim().toUpperCase())) return true;

  const endTime = openTime + barMs;
  if (!Number.isFinite(endTime)) return false;
  if (!isRegularTradingInstant(openTime) || !isRegularTradingInstant(Math.max(openTime, endTime - 1))) return false;

  // Regular closures start on the hour. Check every hour boundary so a long
  // interval cannot appear open merely because both endpoints are open.
  for (let time = Math.floor(openTime / HOUR_MS) * HOUR_MS + HOUR_MS; time < endTime; time += HOUR_MS) {
    if (!isRegularTradingInstant(time)) return false;
  }
  return true;
}

/** Open times of expected bars entirely inside a hold, excluding regular MES/MNQ closures. */
export function expectedInsideBarTimes(entry: number, exit: number, barMs: number, symbol?: string): number[] {
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || exit <= entry || barMs <= 0) return [];
  const times: number[] = [];
  let time = Math.ceil(entry / barMs) * barMs;
  if (time < entry) time += barMs;
  while (time + barMs <= exit) {
    if (isRegularTradingBarInterval(symbol, time, barMs)) times.push(time);
    time += barMs;
  }
  return times;
}

function zonedTimeUtc(date: string, hour: number, minute = 0): number {
  const [year, month, day] = date.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = Object.fromEntries(nyFormat.formatToParts(new Date(utcGuess)).map((part) => [part.type, part.value]));
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
  );
  return utcGuess - (asIfUtc - utcGuess);
}

/** Session dates are day labels. UTC here performs calendar arithmetic on the label. */
export function offsetSessionDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function sessionWeekMonday(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return offsetSessionDate(date, -((weekday + 6) % 7));
}

/** Regular MES/MNQ hours for a trading date, in UTC milliseconds (OD-35). */
export function equityIndexSessionBounds(date: string) {
  return {
    open: zonedTimeUtc(offsetSessionDate(date, -1), 18),
    rthOpen: zonedTimeUtc(date, 9, 30),
    rthClose: zonedTimeUtc(date, 16),
    close: zonedTimeUtc(date, 17),
  };
}

/**
 * The trading day an instant belongs to, as `YYYY-MM-DD`.
 * The Globex evening (from 18:00 ET) belongs to the next day's session, and the weekend rolls to Monday.
 */
export function sessionDate(instant: number | string) {
  const ms = typeof instant === "string" ? Date.parse(instant) : instant;
  const parts = Object.fromEntries(nyFormat.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  let day = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  if (Number(parts.hour) % 24 >= 18) day += DAY_MS;
  const weekday = new Date(day).getUTCDay();
  if (weekday === 6) day += 2 * DAY_MS;
  else if (weekday === 0) day += DAY_MS;
  return new Date(day).toISOString().slice(0, 10);
}

/** The 17:00 America/New_York close after an exit, including evening and weekend session assignment. */
export function sessionCloseUtc(instant: number | string) {
  const ms = typeof instant === "string" ? Date.parse(instant) : instant;
  const assignedClose = zonedTimeUtc(sessionDate(ms), 17);
  return assignedClose >= ms ? assignedClose : zonedTimeUtc(sessionDate(ms + DAY_MS), 17);
}

const dayLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const dayLabelLong = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });

/** `Fri, Nov 13` for a session date string. */
export function formatSessionDate(date: string, long = false) {
  return (long ? dayLabelLong : dayLabel).format(new Date(`${date}T00:00:00Z`));
}
