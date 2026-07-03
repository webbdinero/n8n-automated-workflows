import { createApp } from "./server.js";
import { config } from "./config.js";

const { app, container } = createApp();

// Refresh scores at boot so risk reflects the current date across every tenant.
for (const org of container.orgs.list()) {
  container.grantService.refreshAllScores(org.id);
}

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `\n  GrantGuard running → http://localhost:${config.port}\n` +
      `  DB: ${config.databasePath}\n` +
      `  Default org: ${config.defaultOrgSlug}\n`,
  );
});
