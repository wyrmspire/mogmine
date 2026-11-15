// Retry helper for Yahoo and PostgREST calls (AC-04). 429 and 5xx are retried with
// backoff. 422 is never retried. Network failures are retried.

export interface RetryOptions {
  retries?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  shouldRetry?: (error: unknown) => boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function statusFromError(error: unknown): number | null {
  if (typeof error === "object" && error && "status" in error && typeof (error as { status: unknown }).status === "number") {
    return (error as { status: number }).status;
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = /(?:returned|status)\s+(\d{3})/i.exec(message);
  return match ? Number(match[1]) : null;
}

export function isRetryableError(error: unknown): boolean {
  const status = statusFromError(error);
  if (status === 422 || status === 404 || status === 400 || status === 401 || status === 403) return false;
  if (status === 429 || (status != null && status >= 500)) return true;
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /network|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket/i.test(message);
}

export async function withRetries<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 4;
  const delayMs = options.delayMs ?? 1_000;
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? isRetryableError;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error)) throw error;
      await sleep(delayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
