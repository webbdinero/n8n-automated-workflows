import { Router, type Express, type Request, type Response, type NextFunction } from "express";
import type { Container } from "../container.js";
import { grantInputSchema, grantUpdateSchema } from "../domain/schemas.js";
import { portfolioSummary } from "../services/metrics.js";
import { deriveAlerts } from "../services/alertService.js";
import { comparePeers } from "../services/benchmarkService.js";
import { DuplicateGrantError, NotFoundError, ValidationError } from "../services/errors.js";
import { can, remainingGrants, entitlementsFor } from "../domain/plans.js";

function wrap(fn: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

/**
 * JSON API — the same domain services behind a machine interface. This is the
 * integration surface for n8n / automation workflows to push and pull grant
 * data, so the productized service can be wired to existing pipelines.
 */
export function registerApiRoutes(app: Express, c: Container): void {
  const api = Router();

  api.get(
    "/grants",
    wrap((req, res) => {
      const org = res.locals.org;
      const grants = c.grants.list(org.id, {
        status: (req.query.status as string) || undefined,
        funding_source: (req.query.funding_source as string) || undefined,
        classification: (req.query.classification as string) || undefined,
        risk_tier: (req.query.risk_tier as string) || undefined,
        q: (req.query.q as string) || undefined,
        sort: (req.query.sort as string) || "risk_desc",
      });
      res.json({ count: grants.length, grants });
    }),
  );

  api.get(
    "/grants/:id",
    wrap((req, res) => {
      const grant = c.grants.findById(req.params.id!);
      if (!grant || grant.org_id !== res.locals.org.id) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({
        grant,
        tasks: c.tasks.listForGrant(grant.id),
        events: c.events.listForGrant(grant.id),
      });
    }),
  );

  api.post(
    "/grants",
    wrap((req, res) => {
      const org = res.locals.org;
      const remaining = remainingGrants(org, c.grants.listAll(org.id).length);
      if (remaining !== null && remaining <= 0) {
        res.status(402).json({
          error: "plan_limit_reached",
          message: `Plan allows up to ${entitlementsFor(org).maxGrants} grants. Upgrade to add more.`,
        });
        return;
      }
      const parsed = grantInputSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "validation_error",
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
        return;
      }
      try {
        const grant = c.grantService.createGrant(org.id, parsed.data, {
          actor: (req.header("x-actor") as string) || "api",
          source: "api",
        });
        res.status(201).json({ grant });
      } catch (err) {
        if (err instanceof DuplicateGrantError) {
          res.status(409).json({ error: "duplicate", message: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  api.patch(
    "/grants/:id",
    wrap((req, res) => {
      const id = req.params.id!;
      const grant = c.grants.findById(id);
      if (!grant || grant.org_id !== res.locals.org.id) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const parsed = grantUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "validation_error",
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
        return;
      }
      try {
        const updated = c.grantService.updateGrant(id, parsed.data, {
          actor: (req.header("x-actor") as string) || "api",
          source: "api",
        });
        res.json({ grant: updated });
      } catch (err) {
        if (err instanceof NotFoundError) {
          res.status(404).json({ error: "not_found" });
          return;
        }
        throw err;
      }
    }),
  );

  api.get(
    "/summary",
    wrap((_req, res) => {
      const org = res.locals.org;
      res.json(
        portfolioSummary(c.grants.listAll(org.id), c.tasks.listForOrg(org.id)),
      );
    }),
  );

  api.get(
    "/alerts",
    wrap((_req, res) => {
      const org = res.locals.org;
      res.json({
        alerts: deriveAlerts(c.grants.listAll(org.id), c.tasks.listForOrg(org.id)),
      });
    }),
  );

  api.get(
    "/benchmarks",
    wrap((_req, res) => {
      const org = res.locals.org;
      if (!can(org, "benchmarks")) {
        res.status(402).json({ error: "upgrade_required", feature: "benchmarks" });
        return;
      }
      const allOrgs = c.orgs.list();
      const current = {
        grants: c.grants.listAll(org.id),
        tasks: c.tasks.listForOrg(org.id),
      };
      const peers = allOrgs
        .filter((o) => o.id !== org.id && o.data_sharing_opt_in)
        .map((o) => ({ grants: c.grants.listAll(o.id), tasks: c.tasks.listForOrg(o.id) }));
      res.json(comparePeers(current, peers));
    }),
  );

  // JSON 404 for unknown /api routes.
  api.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });

  // JSON error handler — never render HTML for API clients.
  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: "validation_error", message: err.message, issues: err.issues });
      return;
    }
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  app.use("/api", api);
}
