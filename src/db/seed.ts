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
}
// eslint-disable-next-line no-console
console.log("\nDone. Start the app with: npm start\n");
