/**
 * Scraper Watchdog — Per-Scraper Circuit Breaker Registry
 * ────────────────────────────────────────────────────────
 * The hub serves ~30 endpoints across ~10 target sites (LinkedIn,
 * Instagram, Reddit, Airbnb, Google Maps, …). When one of those sites
 * changes its DOM or starts blocking us, the failure must NOT take
 * down the whole hub.
 *
 * This module keeps one circuit breaker per logical scraper. Each call
 * goes through `safeScrape(name, fn)`:
 *
 *   - closed  : normal — call fn, count successes/failures
 *   - open    : recently broken — return a graceful 503 immediately,
 *               do not even hit the target site
 *   - half_open: cooldown elapsed — let one trial call through; on
 *               success → close, on failure → re-open
 *
 * The registry is exposed via getWatchdogSnapshot() so /health/scrapers
 * can show live status to operators and AI agents.
 */

import { classifyFailure, type FailureKind } from './self-healing';

export type BreakerState = 'closed' | 'open' | 'half_open';

interface BreakerStats {
  state: BreakerState;
  consecutiveFailures: number;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureKind?: FailureKind;
  lastFailureMessage?: string;
  lastFailureAt?: string;
  lastSuccessAt?: string;
  openedAt?: string;
  cooldownUntil?: string;
}

export interface WatchdogConfig {
  /** Open after N consecutive classified failures. */
  failureThreshold: number;
  /** Stay open this long before allowing a trial call. */
  cooldownMs: number;
  /** Optional logger; defaults to console. */
  logger: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void };
}

const DEFAULT_CONFIG: WatchdogConfig = {
  failureThreshold: 5,
  cooldownMs: 60_000,
  logger: console,
};

let CONFIG: WatchdogConfig = { ...DEFAULT_CONFIG };

const breakers = new Map<string, BreakerStats>();

export class ScraperUnavailableError extends Error {
  scraper: string;
  state: BreakerState;
  reason?: string;
  cooldownMs: number;
  constructor(scraper: string, state: BreakerState, cooldownMs: number, reason?: string) {
    super(`Scraper "${scraper}" is ${state} (cooldown ${cooldownMs}ms): ${reason || 'recently failing'}`);
    this.name = 'ScraperUnavailableError';
    this.scraper = scraper;
    this.state = state;
    this.cooldownMs = cooldownMs;
    this.reason = reason;
  }
}

function ensure(name: string): BreakerStats {
  let b = breakers.get(name);
  if (!b) {
    b = {
      state: 'closed',
      consecutiveFailures: 0,
      totalCalls: 0,
      totalFailures: 0,
      totalSuccesses: 0,
    };
    breakers.set(name, b);
  }
  return b;
}

function transition(b: BreakerStats, name: string, to: BreakerState, reason?: string) {
  if (b.state === to) return;
  CONFIG.logger.warn(`[watchdog] ${name}: ${b.state} → ${to}${reason ? ` (${reason})` : ''}`);
  b.state = to;
  if (to === 'open') {
    b.openedAt = new Date().toISOString();
    b.cooldownUntil = new Date(Date.now() + CONFIG.cooldownMs).toISOString();
  } else if (to === 'closed') {
    b.openedAt = undefined;
    b.cooldownUntil = undefined;
    b.consecutiveFailures = 0;
  }
}

/**
 * Run `fn` under the per-scraper circuit breaker.
 *
 * - If the breaker is OPEN and cooldown hasn't elapsed, we throw
 *   ScraperUnavailableError immediately (never hits the site).
 * - If OPEN and cooldown elapsed → HALF_OPEN, call fn once.
 * - On success: close breaker.
 * - On failure: classify, count, open if threshold crossed.
 *
 * The CALLER is responsible for catching ScraperUnavailableError and
 * returning HTTP 503 to the client. By default the global Hono onError
 * handler does this — see src/index.ts.
 */
export async function safeScrape<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const b = ensure(name);
  b.totalCalls++;

  // Check breaker state.
  if (b.state === 'open') {
    const cdUntil = b.cooldownUntil ? Date.parse(b.cooldownUntil) : 0;
    if (Date.now() < cdUntil) {
      throw new ScraperUnavailableError(name, 'open', cdUntil - Date.now(), b.lastFailureMessage);
    }
    transition(b, name, 'half_open', 'cooldown elapsed — trial call');
  }

  try {
    const value = await fn();
    b.totalSuccesses++;
    b.consecutiveFailures = 0;
    b.lastSuccessAt = new Date().toISOString();
    if (b.state !== 'closed') transition(b, name, 'closed', 'recovered');
    return value;
  } catch (err: any) {
    const kind = classifyFailure(err);
    const msg = err?.message || String(err);
    b.totalFailures++;
    b.consecutiveFailures++;
    b.lastFailureKind = kind;
    b.lastFailureMessage = msg.slice(0, 300);
    b.lastFailureAt = new Date().toISOString();

    CONFIG.logger.error(
      `[watchdog] ${name} failure (${kind}, ${b.consecutiveFailures} consecutive): ${msg.slice(0, 200)}`,
    );

    // From half_open, a single failure re-opens the breaker.
    if (b.state === 'half_open') {
      transition(b, name, 'open', `half-open trial failed (${kind})`);
    } else if (b.consecutiveFailures >= CONFIG.failureThreshold) {
      transition(b, name, 'open', `${b.consecutiveFailures} consecutive failures (${kind})`);
    }

    throw err;
  }
}

/** Reconfigure the watchdog (threshold, cooldown). */
export function configureWatchdog(partial: Partial<WatchdogConfig>): void {
  CONFIG = { ...CONFIG, ...partial };
}

/** Manually force a breaker closed (e.g. after deploying a fix). */
export function resetBreaker(name: string): boolean {
  const b = breakers.get(name);
  if (!b) return false;
  transition(b, name, 'closed', 'manual reset');
  b.consecutiveFailures = 0;
  return true;
}

/** Live snapshot for /health/scrapers. */
export function getWatchdogSnapshot() {
  const out: Record<string, BreakerStats & { healthRatio: number }> = {};
  for (const [name, b] of breakers) {
    const healthRatio = b.totalCalls > 0 ? b.totalSuccesses / b.totalCalls : 1;
    out[name] = { ...b, healthRatio: Number(healthRatio.toFixed(3)) };
  }
  return {
    config: { failureThreshold: CONFIG.failureThreshold, cooldownMs: CONFIG.cooldownMs },
    breakers: out,
    summary: {
      total: breakers.size,
      open: [...breakers.values()].filter((b) => b.state === 'open').length,
      halfOpen: [...breakers.values()].filter((b) => b.state === 'half_open').length,
      closed: [...breakers.values()].filter((b) => b.state === 'closed').length,
    },
  };
}
