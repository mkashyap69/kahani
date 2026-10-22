export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  /** return false to stop retrying (e.g. 4xx validation errors) */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 4, baseMs = 1000, maxMs = 30_000, shouldRetry = isRetryable, onRetry } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err, attempt)) throw err;
      const delay = Math.random() * Math.min(maxMs, baseMs * 2 ** attempt);
      onRetry?.(err, attempt, delay);
      await sleep(delay);
      attempt++;
    }
  }
}

export class NonRetryableError extends Error {
  readonly nonRetryable = true;
}

export function isRetryable(err: unknown): boolean {
  if (err && typeof err === "object") {
    if ((err as { nonRetryable?: boolean }).nonRetryable) return false;
    const status = (err as { status?: number }).status ?? (err as { code?: number }).code;
    if (typeof status === "number" && status >= 400 && status < 500) return status === 408 || status === 409 || status === 429;
  }
  return true;
}

/** Minimal concurrency limiter (p-limit style). */
export function limiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= Math.max(1, concurrency)) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

/** Run fn over items with a concurrency limit; collects per-item errors instead of failing fast. */
export async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<{ results: (R | undefined)[]; errors: { index: number; error: unknown }[] }> {
  const run = limiter(concurrency);
  const results: (R | undefined)[] = new Array(items.length);
  const errors: { index: number; error: unknown }[] = [];
  await Promise.all(
    items.map((item, i) =>
      run(async () => {
        try {
          results[i] = await fn(item, i);
        } catch (error) {
          errors.push({ index: i, error });
        }
      }),
    ),
  );
  return { results, errors };
}
