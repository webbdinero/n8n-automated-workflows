import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/server.js";
import { createContainer, type Container } from "../src/container.js";
import { openMemoryDb } from "../src/db/connection.js";
import { config } from "../src/config.js";
import { csrfFromSessionValue } from "../src/auth/csrf.js";
import { grantInput } from "./support.js";

let server: Server;
let baseUrl: string;
let c: Container;
let grantId: string;
let cookie: string;
let csrf: string;

async function post(path: string, body: Record<string, string>) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({ ...body, _csrf: csrf }),
    redirect: "manual",
  });
}

beforeAll(async () => {
  c = createContainer(openMemoryDb());
  const org = c.orgs.create({ slug: config.defaultOrgSlug, name: "Pilot", type: "municipality" });
  c.users.create({ org_id: org.id, email: "ig@city.gov", name: "IG", role: "admin", password: "pw12345678" });
  grantId = c.grantService.createGrant(org.id, grantInput(), { actor: "seed", source: "manual" }).id;

  const { app } = createApp({ container: c, ensureDefaultOrg: false });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
      resolve();
    });
  });

  const login = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: "ig@city.gov", password: "pw12345678" }),
    redirect: "manual",
  });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  csrf = csrfFromSessionValue(cookie.slice(cookie.indexOf("=") + 1), config.sessionSecret)!;
});

afterAll(() => server?.close());

describe("IG console — evidence, case file, change history, anomalies", () => {
  it("adds evidence which renders on the grant detail page", async () => {
    const r = await post(`/grants/${grantId}/evidence`, { type: "note", note: "missing procurement docs" });
    expect(r.status).toBe(302);
    const page = await (await fetch(`${baseUrl}/grants/${grantId}`, { headers: { cookie } })).text();
    expect(page).toContain("Evidence");
    expect(page).toContain("missing procurement docs");
    expect(page).toContain("Change History");
  });

  it("exports a standalone case-file HTML including grant + evidence", async () => {
    const res = await fetch(`${baseUrl}/grants/${grantId}/casefile`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Case File");
    expect(html).toContain(c.grants.findById(grantId)!.grant_number);
    expect(html).toContain("missing procurement docs");

    const dl = await fetch(`${baseUrl}/grants/${grantId}/casefile?download=1`, { headers: { cookie } });
    expect(dl.headers.get("content-disposition")).toContain("attachment");
  });

  it("flags an anomaly (repeated notes) that appears in the Anomalies queue", async () => {
    // Two more note-type evidence items → crosses the repeated-notes threshold (3).
    await post(`/grants/${grantId}/evidence`, { type: "note", note: "unclear invoice 2" });
    await post(`/grants/${grantId}/evidence`, { type: "note", note: "unclear invoice 3" });

    const open = c.anomalyService.listOpen(c.orgs.findBySlug(config.defaultOrgSlug)!.id);
    expect(open.some((a) => a.rule_name === "repeated_documentation_notes")).toBe(true);

    const queue = await (await fetch(`${baseUrl}/anomalies`, { headers: { cookie } })).text();
    expect(queue).toContain("Repeated Documentation Notes");
    expect(queue).toContain(c.grants.findById(grantId)!.grant_number);
  });

  it("records an admin status change on an anomaly (auditable)", async () => {
    const anomaly = c.anomalyService.listOpen(c.orgs.findBySlug(config.defaultOrgSlug)!.id)[0]!;
    const r = await post(`/anomalies/${anomaly.id}/status`, { status: "under_review", note: "assigned to investigator" });
    expect(r.status).toBe(302);
    expect(c.anomalies.findById(anomaly.id)!.status).toBe("under_review");
    expect(c.events.listForGrant(anomaly.grant_id).some((e) => e.event_type === "anomaly_reviewed")).toBe(true);
  });
});
