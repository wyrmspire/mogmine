/**
 * America/New_York clock helpers for the Context Card (SL-7). Pure. Offsets are read from the zone every time,
 * never fixed, so DST days are right (docs/design-2026-11-24/09 §4.4, AGENTS §3b-5).
 */

const etFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

export function etParts(time: number): Record<string, number> {
  const parts = Object.fromEntries(etFormat.formatToParts(new Date(time)).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute),
  };
}

/** UTC ms of a wall-clock ET calendar date (`YYYY-MM-DD`) and minute of the day (0–1439). */
export function etToUtc(date: string, minuteOfDay: number): number {
  const [y, m, d] = date.split("-").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  let guess = wallAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const p = etParts(guess);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wallAsUtc - shown;
  }
  return guess;
}

/** `HH:MM` ET for a UTC instant. */
export function clockText(time: number): string {
  const p = etParts(time);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
