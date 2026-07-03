import { describe, it, expect } from "vitest";
import { newCtx } from "./support.js";

describe("SubscriptionService audit log", () => {
  it("records who/when/old→new/reason for each changed field", () => {
    const { c, org } = newCtx();
    expect(org.plan).toBe("trial");

    c.subscriptionService.updateSubscription(
      org.id,
      { plan: "pilot", subscription_status: "active", data_sharing_opt_in: true },
      { actor: "jane@borough.gov", reason: "Converted after pilot kickoff" },
    );

    const updated = c.orgs.findById(org.id)!;
    expect(updated.plan).toBe("pilot");
    expect(updated.subscription_status).toBe("active");
    expect(updated.data_sharing_opt_in).toBe(true);

    const log = c.subscriptionService.history(org.id);
    const planEvent = log.find((e) => e.field === "plan");
    expect(planEvent).toBeTruthy();
    expect(planEvent!.actor).toBe("jane@borough.gov");
    expect(planEvent!.old_value).toBe("trial");
    expect(planEvent!.new_value).toBe("pilot");
    expect(planEvent!.reason).toBe("Converted after pilot kickoff");
    expect(typeof planEvent!.at).toBe("string");

    // Boolean changes are recorded as readable values.
    const optIn = log.find((e) => e.field === "data_sharing_opt_in");
    expect(optIn!.old_value).toBe("false");
    expect(optIn!.new_value).toBe("true");
  });

  it("only logs fields that actually changed (no-op writes nothing)", () => {
    const { c, org } = newCtx();
    // Same plan as current, only status changes.
    c.subscriptionService.updateSubscription(
      org.id,
      { plan: "trial", subscription_status: "active" },
      { actor: "system" },
    );
    const fields = c.subscriptionService.history(org.id).map((e) => e.field);
    expect(fields).toContain("subscription_status");
    expect(fields).not.toContain("plan"); // unchanged → not logged
  });

  it("is append-only: prior entries are preserved across changes", () => {
    const { c, org } = newCtx();
    c.subscriptionService.updateSubscription(org.id, { plan: "pilot" }, { actor: "a", reason: "first" });
    const afterFirst = c.subscriptionService.history(org.id);
    expect(afterFirst).toHaveLength(1);

    c.subscriptionService.updateSubscription(org.id, { plan: "standard" }, { actor: "b", reason: "second" });
    const afterSecond = c.subscriptionService.history(org.id);
    expect(afterSecond.length).toBe(2);

    // The original entry is unchanged (immutable history).
    const original = afterSecond.find((e) => e.id === afterFirst[0]!.id)!;
    expect(original.new_value).toBe("pilot");
    expect(original.reason).toBe("first");

    // The repository exposes no mutation/deletion API.
    const repoKeys = Object.getOwnPropertyNames(
      Object.getPrototypeOf(c.subscriptionEvents),
    );
    expect(repoKeys).not.toContain("update");
    expect(repoKeys).not.toContain("delete");
  });

  it("returns the org unchanged when nothing differs", () => {
    const { c, org } = newCtx();
    const result = c.subscriptionService.updateSubscription(
      org.id,
      { plan: "trial", subscription_status: "trialing", data_sharing_opt_in: false },
      { actor: "noop" },
    );
    expect(result.plan).toBe("trial");
    expect(c.subscriptionService.history(org.id)).toHaveLength(0);
  });
});
