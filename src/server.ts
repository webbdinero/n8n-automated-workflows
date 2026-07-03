import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { config } from "./config.js";
import { createContainer, type Container } from "./container.js";
import { formatHelpers } from "./web/format.js";
import { registerWebRoutes } from "./routes/webRoutes.js";
import { registerApiRoutes } from "./routes/apiRoutes.js";
import { deriveAlerts } from "./services/alertService.js";
import { entitlementsFor } from "./domain/plans.js";
import {
  CLASSIFICATIONS,
  FUNDING_SOURCES,
  GRANT_STATUSES,
  PLANS,
  RISK_TIERS,
  SUBSCRIPTION_STATUSES,
  TASK_TYPES,
} from "./domain/constants.js";

export interface AppOptions {
  container?: Container;
  /** Ensure a default org exists on boot (skip in some tests). */
  ensureDefaultOrg?: boolean;
}

export function createApp(opts: AppOptions = {}): { app: Express; container: Container } {
  const container = opts.container ?? createContainer();
  const app = express();

  app.set("view engine", "ejs");
  app.set("views", config.viewsDir);

  // Formatters + enum constants available in every template.
  Object.assign(app.locals, formatHelpers);
  app.locals.appName = "GrantGuard";
  app.locals.enums = {
    FUNDING_SOURCES,
    GRANT_STATUSES,
    CLASSIFICATIONS,
    RISK_TIERS,
    TASK_TYPES,
    PLANS,
    SUBSCRIPTION_STATUSES,
  };

  app.use(express.static(config.publicDir));
  app.use(express.urlencoded({ extended: true, limit: "5mb" }));
  app.use(express.json({ limit: "5mb" }));

  if (opts.ensureDefaultOrg !== false) {
    container.orgs.ensure({
      slug: config.defaultOrgSlug,
      name: "Demo Borough (Pilot)",
      type: "municipality",
      state: "PA",
      population: 18500,
    });
  }

  // Per-request context: active org, actor, nav state, live alert count.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const org =
      container.orgs.findBySlug(config.defaultOrgSlug) ??
      container.orgs.list()[0] ??
      null;
    res.locals.org = org;
    res.locals.orgs = container.orgs.list();
    res.locals.actor = "Pilot Admin";
    res.locals.path = req.path;
    res.locals.query = req.query;
    res.locals.entitlements = org ? entitlementsFor(org) : null;
    if (org) {
      const grants = container.grants.listAll(org.id);
      const tasks = container.tasks.listForOrg(org.id);
      res.locals.navAlertCount = deriveAlerts(grants, tasks).length;
    } else {
      res.locals.navAlertCount = 0;
    }
    next();
  });

  registerWebRoutes(app, container);
  registerApiRoutes(app, container);

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // 404
  app.use((req: Request, res: Response) => {
    res.status(404).render("error", {
      title: "Not found",
      message: `No route for ${req.method} ${req.path}`,
    });
  });

  // Error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).render("error", { title: "Something went wrong", message });
  });

  return { app, container };
}
