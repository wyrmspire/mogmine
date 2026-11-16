// Session math. Always America/New_York, never a fixed offset and never the display zone
// (AGENTS §3b-5, B-20, UX-87).

const NEW_YORK = "America/New_York";

const nyFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK,
  hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
});

const DAY_MS = 86_400_000;

function zonedHourUtc(date: string, hour: number): number {
  const [year, month, day] = date.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: NEW_YORK,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(utcGuess)).map((part) => [part.type, part.value]));
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
  );
  return utcGuess - (asIfUtc - utcGuess);
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
  const assignedClose = zonedHourUtc(sessionDate(ms), 17);
  return assignedClose >= ms ? assignedClose : zonedHourUtc(sessionDate(ms + DAY_MS), 17);
}

const dayLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const dayLabelLong = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });

/** `Fri, Nov 13` for a session date string. */
export function formatSessionDate(date: string, long = false) {
  return (long ? dayLabelLong : dayLabel).format(new Date(`${date}T00:00:00Z`));
}
