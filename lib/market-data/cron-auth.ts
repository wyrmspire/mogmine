// Server only. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
import { createHash, timingSafeEqual } from "node:crypto";

/** Fails closed: no configured secret means nothing is authorised. */
export function isAuthorizedCron(header: string | null, secret: string | undefined): boolean {
  if (!secret?.trim() || !header) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret.trim()}`));
}
