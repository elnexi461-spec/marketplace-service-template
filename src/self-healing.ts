/**
 * Self-Healing Engine — Cloud-Proxy Edition
 * ─────────────────────────────────────────
 * Wraps any scraping operation with classified retries:
 *
 *   • 403 / 429       →  immediate retry (ScraperAPI auto-rotates IP)
 *   • Timeout         →  short backoff, then retry
 *   • DOM Mismatch    →  fallback selector hook, immediate retry
 *   • Network         →  short backoff, then retry
 *
 * Hard-capped at 3 attempts. After exhausting retries the wrapper
 * returns a settled failure (HTTP 500-style envelope) so the caller
 * can surface the failure to the paying client without crashing the
 * worker or wasting on-chain payment data.
 *
 * (The legacy 30-second mobile-IP-rotation wait has been removed —
 * ScraperAPI provides a fresh exit IP on every request automatically.)
 */

export type FailureKind =
  | 'forbidden'        // 403 or 429 — ScraperAPI will auto-rotate IP next call
  | 'timeout'
  | 'dom_mismatch'
  | 'network'
  | 'unknown';

export interface AttemptContext {
  /** 1-indexed attempt number passed to the operation. */
  attempt: number;
  /** Why the previous attempt failed, if any. */
  lastFailure?: FailureKind;
  /** Whether the next call should try a fallback selector path. */
  useFallbackSelector: boolean;
}

export interface HealingResult<T> {
  ok: boolean;
  value?: T;
  attempts: number;
  failures: FailureKind[];
  /** Last error message, if the operation never succeeded. */
  error?: string;
  /** True when the operation gave up after MAX_ATTEMPTS — caller should return 500. */
  settledFailure: boolean;
}

export interface HealingOptions {
  maxAttempts?: number;
  /** Optional logger; defaults to console. */
  logger?: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void };
  /** Optional sink for HTML structure when a DOM mismatch is detected. */
  onDomMismatch?: (snippet: string, attempt: number) => void;
}

const DEFAULT_MAX_ATTEMPTS = 3;

export class CircuitBreakerError extends Error {
  kind: FailureKind;
  htmlSnippet?: string;
  constructor(kind: FailureKind, message: string, htmlSnippet?: string) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.kind = kind;
    this.htmlSnippet = htmlSnippet;
  }
}

/**
 * Classify an arbitrary error / result envelope into a FailureKind.
 *
 * Accepts:
 *   • Plain Error instances (matches against message + status property)
 *   • ScraperApiError (has `status` field)
 *   • { http_status, error } envelopes returned by scrapers
 *   • CircuitBreakerError (preserves its declared kind)
 */
export function classifyFailure(err: unknown): FailureKind {
  if (err instanceof CircuitBreakerError) return err.kind;

  const e = err as any;
  const status: number | undefined = e?.http_status ?? e?.status ?? e?.statusCode;
  const msg: string = String(e?.message ?? e?.error ?? e ?? '').toLowerCase();

  if (status === 403 || status === 429 || /\b(403|429)\b|forbidden|too many requests|rate limit|access denied|blocked/.test(msg)) {
    return 'forbidden';
  }
  if (/timeout|timed out|etimedout|aborterror|signal is aborted/.test(msg)) {
    return 'timeout';
  }
  if (/dom|selector|extract|captcha|bot wall|could not extract/.test(msg)) {
    return 'dom_mismatch';
  }
  if (/network|econnreset|enotfound|fetch failed|socket/.test(msg)) {
    return 'network';
  }
  return 'unknown';
}

/** Wait `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Recovery delay for a given failure kind. */
function delayFor(kind: FailureKind, attempt: number): number {
  switch (kind) {
    case 'forbidden':
      return 0;                  // ScraperAPI rotates IP automatically — retry now
    case 'dom_mismatch':
      return 250;                // immediate fallback retry
    case 'timeout':
      return 1_500 * attempt;    // gentle linear backoff
    case 'network':
      return 1_000 * attempt;
    default:
      return 750 * attempt;
  }
}

/**
 * Execute `op` with the self-healing circuit breaker.
 *
 * The operation receives an AttemptContext on each call so it can:
 *   - know which attempt this is
 *   - swap to a fallback selector path on dom_mismatch
 *
 * The operation should either return its successful value or throw
 * (Error, CircuitBreakerError, ScraperApiError, or a `{ http_status, error }` envelope).
 */
export async function withSelfHealing<T>(
  op: (ctx: AttemptContext) => Promise<T>,
  options: HealingOptions = {},
): Promise<HealingResult<T>> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const log = options.logger ?? console;

  const failures: FailureKind[] = [];
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctx: AttemptContext = {
      attempt,
      lastFailure: failures[failures.length - 1],
      useFallbackSelector: failures[failures.length - 1] === 'dom_mismatch',
    };

    try {
      const value = await op(ctx);
      return { ok: true, value, attempts: attempt, failures, settledFailure: false };
    } catch (err: any) {
      const kind = classifyFailure(err);
      failures.push(kind);
      lastError = err?.message || String(err);

      log.warn(
        `[self-heal] attempt ${attempt}/${maxAttempts} failed (${kind}): ${lastError}`,
      );

      if (kind === 'dom_mismatch' && err instanceof CircuitBreakerError && err.htmlSnippet) {
        try { options.onDomMismatch?.(err.htmlSnippet, attempt); }
        catch (sinkErr) { log.error('[self-heal] onDomMismatch sink threw', sinkErr); }
      }

      if (attempt >= maxAttempts) break;

      const wait = delayFor(kind, attempt);
      if (wait > 0) {
        log.info(`[self-heal] waiting ${wait}ms before retry (kind=${kind})`);
        await sleep(wait);
      } else {
        log.info(`[self-heal] retrying immediately (kind=${kind} → ScraperAPI IP rotation)`);
      }
    }
  }

  return {
    ok: false,
    attempts: maxAttempts,
    failures,
    error: lastError || 'Operation failed',
    settledFailure: true,
  };
}
