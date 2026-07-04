export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
  lockoutMs: number;
}

export interface RateLimitStatus {
  locked: boolean;
  retryAfterMs: number;
  remaining: number;
}

interface Entry {
  count: number;
  firstAt: number;
  lockedUntil: number;
}

const DEFAULTS: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  lockoutMs: 15 * 60 * 1000, // 15 minutes
};

/**
 * In-memory login throttle. Counts failed attempts per key (email+IP) within a
 * rolling window and locks the key out after `maxAttempts` failures. Simple and
 * dependency-free — appropriate for a single-instance pilot. For multi-instance
 * deployments, swap the Map for Redis behind the same interface.
 */
export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly cfg: RateLimitConfig;

  constructor(cfg: Partial<RateLimitConfig> = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
  }

  /** Current status without recording an attempt. */
  status(key: string, now: number = Date.now()): RateLimitStatus {
    const e = this.entries.get(key);
    if (!e) return { locked: false, retryAfterMs: 0, remaining: this.cfg.maxAttempts };
    if (e.lockedUntil > now) {
      return { locked: true, retryAfterMs: e.lockedUntil - now, remaining: 0 };
    }
    if (now - e.firstAt > this.cfg.windowMs) {
      this.entries.delete(key);
      return { locked: false, retryAfterMs: 0, remaining: this.cfg.maxAttempts };
    }
    return { locked: false, retryAfterMs: 0, remaining: Math.max(0, this.cfg.maxAttempts - e.count) };
  }

  /** Record a failed attempt; returns the resulting status. */
  recordFailure(key: string, now: number = Date.now()): RateLimitStatus {
    this.maybePrune(now);
    let e = this.entries.get(key);
    // Start a fresh window if there's no entry, or a prior window/lockout has
    // fully elapsed.
    if (!e || (e.lockedUntil <= now && now - e.firstAt > this.cfg.windowMs)) {
      e = { count: 0, firstAt: now, lockedUntil: 0 };
    }
    // Still locked → keep it locked without further increment.
    if (e.lockedUntil > now) {
      this.entries.set(key, e);
      return this.status(key, now);
    }
    if (e.count === 0) e.firstAt = now;
    e.count += 1;
    if (e.count >= this.cfg.maxAttempts) {
      e.lockedUntil = now + this.cfg.lockoutMs;
    }
    this.entries.set(key, e);
    return this.status(key, now);
  }

  /** Clear the counter on a successful login. */
  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  private maybePrune(now: number): void {
    if (this.entries.size < 5000) return;
    for (const [k, e] of this.entries) {
      if (e.lockedUntil <= now && now - e.firstAt > this.cfg.windowMs) {
        this.entries.delete(k);
      }
    }
  }
}
