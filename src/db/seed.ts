import { createContainer } from "../container.js";
import { seedDatabase } from "./sampleData.js";

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
// eslint-disable-next-line no-console
console.log("\nDone. Start the app with: npm start\n");
