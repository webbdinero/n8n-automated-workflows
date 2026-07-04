import { createContainer } from "../container.js";
import { config } from "../config.js";
import { seedDatabase } from "./sampleData.js";
import { ensureBootstrapAdmin } from "../auth/bootstrap.js";

/** CLI seed entrypoint: `npm run seed`. Safe to re-run (idempotent per org). */
const container = createContainer();
seedDatabase(container);

const orgs = container.orgs.list();
// eslint-disable-next-line no-console
console.log(`Seeded ${orgs.length} organization(s):`);
for (const org of orgs) {
  const grants = container.grants.listAll(org.id);
  // eslint-disable-next-line no-console
  console.log(`  • ${org.name} (${org.slug}) — ${grants.length} grants`);
}

// Pilot login + API token for the default org.
const pilot = container.orgs.findBySlug(config.defaultOrgSlug) ?? orgs[0];
if (pilot) {
  const password = process.env.SEED_ADMIN_PASSWORD ?? "grantguard-pilot";
  const admin = ensureBootstrapAdmin(container, pilot.id, {
    email: `admin@${pilot.slug}.gov`,
    name: "Pilot Admin",
    password,
  });
  const token = container.orgs.ensureApiToken(pilot.id);
  // eslint-disable-next-line no-console
  console.log("\nSign-in for the pilot org:");
  if (admin.created) {
    // eslint-disable-next-line no-console
    console.log(`  email:    ${admin.email}\n  password: ${admin.password}   (override with SEED_ADMIN_PASSWORD; change before real use)`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`  (admin account already exists — credentials unchanged)`);
  }
  // eslint-disable-next-line no-console
  console.log(`  API token (x-api-key / Bearer): ${token}`);

  // Demo oversight scenario: attach evidence to a flagged grant and run the
  // anomaly rules so the Anomalies queue / Evidence chain are non-empty.
  const flagged = container.grants.findByNumber(pilot.id, "SLFRF-2023-011");
  if (flagged && container.evidence.listForGrant(flagged.id).length === 0) {
    const actor = { email: `admin@${pilot.slug}.gov` };
    container.evidenceService.addEvidence(pilot.id, flagged.id, { type: "note", note: "Subrecipient invoice unclear — requested itemization." }, actor);
    container.evidenceService.addEvidence(pilot.id, flagged.id, { type: "note", note: "Missing timesheet backup for premium pay disbursement." }, actor);
    container.evidenceService.addEvidence(pilot.id, flagged.id, { type: "note", note: "Second follow-up on documentation still outstanding." }, actor);
    container.evidenceService.addEvidence(pilot.id, flagged.id, { type: "link", url: "https://records.demo-borough.gov/slfrf-2023-011/audit-workpaper" }, actor);
    const created = container.anomalyService.recomputeAll(pilot.id);
    // eslint-disable-next-line no-console
    console.log(`  Seeded evidence + ran anomaly rules (${created} anomaly event(s) flagged).`);
  }
}
// eslint-disable-next-line no-console
console.log("\nDone. Start the app with: npm start\n");
