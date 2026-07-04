import { describe, it, expect } from "vitest";
import { LoginRateLimiter } from "../src/auth/loginRateLimiter.js";

describe("LoginRateLimiter", () => {
  const cfg = { maxAttempts: 3, windowMs: 1000, lockoutMs: 5000 };

  it("locks out after maxAttempts failures", () => {
    const rl = new LoginRateLimiter(cfg);
    const now = 1_000_000;
    expect(rl.recordFailure("k", now).locked).toBe(false); // 1
    expect(rl.recordFailure("k", now).locked).toBe(false); // 2
    const third = rl.recordFailure("k", now); // 3 → lock
    expect(third.locked).toBe(true);
    expect(third.retryAfterMs).toBe(cfg.lockoutMs);
    expect(rl.status("k", now).locked).toBe(true);
  });

  it("resets on success", () => {
    const rl = new LoginRateLimiter(cfg);
    rl.recordFailure("k");
    rl.recordFailure("k");
    rl.recordSuccess("k");
    expect(rl.status("k").remaining).toBe(cfg.maxAttempts);
  });

  it("clears the lock once the lockout window elapses", () => {
    const rl = new LoginRateLimiter(cfg);
    const t0 = 0;
    rl.recordFailure("k", t0);
    rl.recordFailure("k", t0);
    rl.recordFailure("k", t0); // locked until t0+5000
    expect(rl.status("k", t0 + 4999).locked).toBe(true);
    expect(rl.status("k", t0 + 6000).locked).toBe(false); // lock + window elapsed
  });

  it("isolates keys (one user/IP does not affect another)", () => {
    const rl = new LoginRateLimiter(cfg);
    rl.recordFailure("a");
    rl.recordFailure("a");
    rl.recordFailure("a"); // a locked
    expect(rl.status("a").locked).toBe(true);
    expect(rl.status("b").locked).toBe(false);
  });
});
