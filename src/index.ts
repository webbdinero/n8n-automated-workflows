import { randomBytes } from "node:crypto";
import { createApp } from "./server.js";
import { config } from "./config.js";
import { ensureBootstrapAdmin } from "./auth/bootstrap.js";

const { app, container } = createApp();

// Refresh scores at boot so risk reflects the current date across every tenant.
for (const org of container.orgs.list()) {
  container.grantService.refreshAllScores(org.id);
}

// Never boot into a locked-out state: ensure the default org has an admin and
// an API token. If none exists and no ADMIN_PASSWORD is set, generate one and
// print it once so the operator can sign in.
const defaultOrg =
  container.orgs.findBySlug(config.defaultOrgSlug) ?? container.orgs.list()[0];
if (defaultOrg) {
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(9).toString("base64url");
  const admin = ensureBootstrapAdmin(container, defaultOrg.id, {
    email: process.env.ADMIN_EMAIL ?? `admin@${defaultOrg.slug}.local`,
    name: "Administrator",
    password,
  });
  if (admin.created) {
    // eslint-disable-next-line no-console
    console.warn(
      `\n  ⚠  Created admin account ${admin.email}\n     Password: ${admin.password}\n     Set ADMIN_PASSWORD (or change it in-app) before real use.\n`,
    );
  }
  container.orgs.ensureApiToken(defaultOrg.id);
}

if (config.sessionSecretIsEphemeral) {
  // eslint-disable-next-line no-console
  console.warn(
    "  ⚠  SESSION_SECRET is unset — using an ephemeral secret; sessions reset on restart. Set SESSION_SECRET for a pilot.\n",
  );
}

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `\n  GrantGuard running → http://localhost:${config.port}\n` +
      `  DB: ${config.databasePath}\n` +
      `  Default org: ${config.defaultOrgSlug}\n`,
  );
});
