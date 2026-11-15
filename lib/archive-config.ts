// Server-only archive configuration. Empty env means the Yahoo path stays as it is today.
// Never log, print, or return the service role key from a helper that might be called in a route body.

export const ARCHIVE_TICKERS = ["MES=F", "MNQ=F"] as const;
export type ArchiveTicker = (typeof ARCHIVE_TICKERS)[number];

export function toArchiveTicker(symbol: string): ArchiveTicker | null {
  const upper = symbol.trim().toUpperCase();
  if (upper === "MES" || upper === "MES=F") return "MES=F";
  if (upper === "MNQ" || upper === "MNQ=F") return "MNQ=F";
  return null;
}

export function isArchiveConfigured(
  env: NodeJS.Dict<string | undefined> = process.env,
): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

/** Read URL + service role for a server client. Returns null when the archive is off. */
export function readArchiveServiceConfig(
  env: NodeJS.Dict<string | undefined> = process.env,
): { url: string; accessKey: string } | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const accessKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !accessKey) return null;
  return { url, accessKey };
}

export const ARCHIVE_NOT_CONFIGURED_MESSAGE =
  "Candle archive is not configured. Charts keep using the Yahoo Finance path. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local (do not commit that file, and do not paste keys into chat). See README section 6.";
