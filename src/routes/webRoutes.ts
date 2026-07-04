import { Router, type Express, type Request, type Response, type NextFunction } from "express";
import type { Container } from "../container.js";
import {
  grantInputSchema,
  grantUpdateSchema,
  taskInputSchema,
} from "../domain/schemas.js";
import type { GrantRecord } from "../domain/schemas.js";
import { portfolioSummary } from "../services/metrics.js";
import { deriveAlerts } from "../services/alertService.js";
import { scoreGrant } from "../services/scoring.js";
import { comparePeers } from "../services/benchmarkService.js";
import { DuplicateGrantError, NotFoundError, ValidationError } from "../services/errors.js";
import {
  TASK_OUTCOMES,
  PLANS,
  SUBSCRIPTION_STATUSES,
  type Plan,
} from "../domain/constants.js";
import {
  can,
  entitlementsFor,
  remainingGrants,
  PLAN_LABELS,
} from "../domain/plans.js";
import { requireAdmin } from "../auth/middleware.js";
import { todayIso } from "../util/dates.js";

/** Wrap an async handler so thrown errors reach Express's error middleware. */
function wrap(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

/** Pick keys from a form body, dropping empty strings (except allowEmpty). */
function pickCleaned(
  body: Record<string, unknown>,
  keys: string[],
  allowEmpty: Set<string> = new Set(),
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = body[k];
    if (v === undefined) continue;
    if (v === "" && !allowEmpty.has(k)) continue;
    out[k] = v;
  }
  return out;
}

const GRANT_FIELDS = [
  "grant_number",
  "title",
  "funding_source",
  "program",
  "grantor",
  "subrecipient",
  "department",
  "category",
  "award_amount",
  "obligated_amount",
  "expended_amount",
  "award_date",
  "obligation_deadline",
  "expenditure_deadline",
  "period_of_performance_end",
  "status",
  "assigned_to",
  "classification",
  "review_notes",
];

function scoringInputs(grant: GrantRecord) {
  return {
    award_amount: grant.award_amount,
    obligated_amount: grant.obligated_amount,
    expended_amount: grant.expended_amount,
    award_date: grant.award_date,
    obligation_deadline: grant.obligation_deadline,
    expenditure_deadline: grant.expenditure_deadline,
    period_of_performance_end: grant.period_of_performance_end,
    status: grant.status,
    assigned_to: grant.assigned_to,
    department: grant.department,
    category: grant.category,
  };
}

export function registerWebRoutes(app: Express, c: Container): void {
  const router = Router();

  /* ------------------------------- Dashboard ------------------------------ */
  router.get(
    "/",
    wrap((_req, res) => {
      const org = res.locals.org;
      const grants = c.grants.listAll(org.id);
      const tasks = c.tasks.listForOrg(org.id);
      const summary = portfolioSummary(grants, tasks);
      const alerts = deriveAlerts(grants, tasks).slice(0, 6);
      const topRisk = grants
        .filter((g) => g.status !== "closed" && g.status !== "deobligated")
        .sort((a, b) => b.risk_score - a.risk_score)
        .slice(0, 6);
      res.render("dashboard", {
        title: "Portfolio Overview",
        summary,
        alerts,
        topRisk,
        recentEvents: c.events.recent(org.id, 8),
      });
    }),
  );

  /* --------------------------------- Grants ------------------------------- */
  router.get(
    "/grants",
    wrap((req, res) => {
      const org = res.locals.org;
      const filters = {
        status: (req.query.status as string) || undefined,
        funding_source: (req.query.funding_source as string) || undefined,
        classification: (req.query.classification as string) || undefined,
        risk_tier: (req.query.risk_tier as string) || undefined,
        assigned_to: (req.query.assigned_to as string) || undefined,
        q: (req.query.q as string) || undefined,
        sort: (req.query.sort as string) || "risk_desc",
      };
      const grants = c.grants.list(org.id, filters);
      res.render("grants_list", {
        title: "Grants",
        grants,
        filters,
        assignees: c.grants.distinctAssignees(org.id),
        total: grants.length,
      });
    }),
  );

  router.get(
    "/grants/new",
    wrap((_req, res) => {
      res.render("grants_new", { title: "New Grant", errors: [], values: {} });
    }),
  );

  router.post(
    "/grants",
    wrap((req, res) => {
      const org = res.locals.org;
      const remaining = remainingGrants(org, c.grants.listAll(org.id).length);
      if (remaining !== null && remaining <= 0) {
        res.status(402).render("upgrade", {
          title: "Grant limit reached",
          feature: `the ${PLAN_LABELS[org.plan as Plan]} plan's grant limit`,
          message: `Your plan allows up to ${entitlementsFor(org).maxGrants} grants. Upgrade to add more.`,
        });
        return;
      }
      const cleaned = pickCleaned(req.body, GRANT_FIELDS, new Set(["review_notes"]));
      const parsed = grantInputSchema.safeParse(cleaned);
      if (!parsed.success) {
        res.status(400).render("grants_new", {
          title: "New Grant",
          errors: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
          values: req.body,
        });
        return;
      }
      try {
        const grant = c.grantService.createGrant(org.id, parsed.data, {
          actor: res.locals.actor,
          source: "manual",
        });
        res.redirect(`/grants/${grant.id}?created=1`);
      } catch (err) {
        if (err instanceof DuplicateGrantError) {
          res.status(409).render("grants_new", {
            title: "New Grant",
            errors: [{ path: "grant_number", message: err.message }],
            values: req.body,
          });
          return;
        }
        throw err;
      }
    }),
  );

  router.get(
    "/grants/:id",
    wrap((req, res) => {
      const grant = c.grants.findById(req.params.id!);
      if (!grant || grant.org_id !== res.locals.org.id) {
        res.status(404).render("error", { title: "Not found", message: "Grant not found" });
        return;
      }
      const tasks = c.tasks.listForGrant(grant.id);
      const events = c.events.listForGrant(grant.id);
      const risk = scoreGrant(
        scoringInputs(grant),
        tasks.map((t) => ({ status: t.status, due_date: t.due_date, outcome: t.outcome })),
        todayIso(),
      );
      res.render("grant_detail", {
        title: grant.grant_number,
        grant,
        tasks,
        events,
        risk,
        taskOutcomes: TASK_OUTCOMES,
        saved: req.query.saved === "1",
        created: req.query.created === "1",
        errorMsg: (req.query.error as string) || null,
      });
    }),
  );

  router.post(
    "/grants/:id",
    wrap((req, res) => {
      const id = req.params.id!;
      const grant = c.grants.findById(id);
      if (!grant || grant.org_id !== res.locals.org.id) {
        res.status(404).render("error", { title: "Not found", message: "Grant not found" });
        return;
      }
      const cleaned = pickCleaned(req.body, GRANT_FIELDS, new Set(["review_notes"]));
      const parsed = grantUpdateSchema.safeParse(cleaned);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        res.redirect(
          `/grants/${id}?error=${encodeURIComponent(
            first ? `${first.path.join(".")}: ${first.message}` : "Invalid input",
          )}`,
        );
        return;
      }
      try {
        c.grantService.updateGrant(id, parsed.data, {
          actor: res.locals.actor,
          source: "manual",
        });
      } catch (err) {
        if (err instanceof ValidationError) {
          res.redirect(`/grants/${id}?error=${encodeURIComponent(err.message)}`);
          return;
        }
        throw err;
      }
      res.redirect(`/grants/${id}?saved=1`);
    }),
  );

  router.post(
    "/grants/:id/tasks",
    wrap((req, res) => {
      const id = req.params.id!;
      const grant = c.grants.findById(id);
      if (!grant || grant.org_id !== res.locals.org.id) {
        res.status(404).render("error", { title: "Not found", message: "Grant not found" });
        return;
      }
      const parsed = taskInputSchema.safeParse({ ...req.body, grant_id: id });
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        res.redirect(
          `/grants/${id}?error=${encodeURIComponent(
            first ? `${first.path.join(".")}: ${first.message}` : "Invalid task",
          )}`,
        );
        return;
      }
      c.grantService.addTask(
        { ...parsed.data, org_id: grant.org_id },
        { actor: res.locals.actor, source: "manual" },
      );
      res.redirect(`/grants/${id}?saved=1#tasks`);
    }),
  );

  router.post(
    "/grants/:id/tasks/:taskId/complete",
    wrap((req, res) => {
      const id = req.params.id!;
      const outcome = (req.body.outcome as string) || undefined;
      const validOutcome = (TASK_OUTCOMES as readonly string[]).includes(outcome ?? "")
        ? (outcome as (typeof TASK_OUTCOMES)[number])
        : undefined;
      c.grantService.completeTask(
        req.params.taskId!,
        { actor: res.locals.actor, source: "manual" },
        validOutcome,
      );
      res.redirect(`/grants/${id}?saved=1#tasks`);
    }),
  );

  router.get(
    "/grants/:id/packet",
    wrap((req, res) => {
      const org = res.locals.org;
      try {
        const premium = can(org, "premiumPackets");
        const packet = c.exportService.buildPacket(req.params.id!, { premium });
        if (packet.grant.org_id !== org.id) throw new NotFoundError();
        c.usage.record({
          org_id: org.id,
          kind: "packet_generated",
          actor: res.locals.actor,
          ref: packet.grant.id,
          meta: premium ? "premium" : "standard",
        });
        res.render("packet", { title: `Compliance Packet — ${packet.grant.grant_number}`, packet });
      } catch (err) {
        if (err instanceof NotFoundError) {
          res.status(404).render("error", { title: "Not found", message: "Grant not found" });
          return;
        }
        throw err;
      }
    }),
  );

  /* --------------------------------- Import ------------------------------- */
  router.get(
    "/import",
    wrap((_req, res) => {
      res.render("import", { title: "Import Grants", result: null, format: "csv" });
    }),
  );

  router.post(
    "/import",
    wrap((req, res) => {
      const org = res.locals.org;
      const format = req.body.format === "json" ? "json" : "csv";
      const text = String(req.body.data ?? "");
      const ctx = { actor: res.locals.actor, source: format as "csv" | "json" };
      const cap = remainingGrants(org, c.grants.listAll(org.id).length);
      const result =
        format === "json"
          ? c.ingestService.ingestJson(org.id, text, ctx, cap)
          : c.ingestService.ingestCsv(org.id, text, ctx, cap);
      if (result.created > 0) {
        c.usage.record({
          org_id: org.id,
          kind: "import",
          actor: res.locals.actor,
          quantity: result.created,
          meta: format,
        });
      }
      res.render("import", { title: "Import Grants", result, format });
    }),
  );

  /* --------------------------------- Alerts ------------------------------- */
  router.get(
    "/alerts",
    wrap((_req, res) => {
      const org = res.locals.org;
      const grants = c.grants.listAll(org.id);
      const tasks = c.tasks.listForOrg(org.id);
      const alerts = deriveAlerts(grants, tasks);
      const groups = {
        critical: alerts.filter((a) => a.severity === "critical"),
        high: alerts.filter((a) => a.severity === "high"),
        medium: alerts.filter((a) => a.severity === "medium"),
      };
      res.render("alerts", { title: "Alerts", alerts, groups });
    }),
  );

  /* ---------------------------------- Admin ------------------------------- */
  router.get(
    "/admin",
    wrap((_req, res) => {
      const org = res.locals.org;
      const allOrgs = c.orgs.list();
      const entitlements = entitlementsFor(org);
      const current = {
        grants: c.grants.listAll(org.id),
        tasks: c.tasks.listForOrg(org.id),
      };
      // Benchmarks are a premium feature and only pool opted-in peers.
      let benchmark = null;
      if (entitlements.benchmarks) {
        const peers = allOrgs
          .filter((o) => o.id !== org.id && o.data_sharing_opt_in)
          .map((o) => ({
            grants: c.grants.listAll(o.id),
            tasks: c.tasks.listForOrg(o.id),
          }));
        benchmark = comparePeers(current, peers);
      }
      res.render("admin", {
        title: "Admin & Settings",
        orgs: allOrgs,
        entitlements,
        planLabel: PLAN_LABELS[org.plan as Plan],
        usage: c.usage.countsByKind(org.id),
        subscriptionHistory: c.subscriptionService.history(org.id, 25),
        apiToken: c.orgs.ensureApiToken(org.id),
        users: c.users.listForOrg(org.id),
        benchmark,
        counts: {
          grants: current.grants.length,
          tasks: current.tasks.length,
          events: c.events.recent(org.id, 100000).length,
        },
        recomputed: null,
      });
    }),
  );

  router.post(
    "/admin/recompute",
    wrap((_req, res) => {
      const org = res.locals.org;
      const changed = c.grantService.refreshAllScores(org.id);
      res.redirect(`/admin?recomputed=${changed}`);
    }),
  );

  router.post(
    "/admin/rotate-token",
    requireAdmin(),
    wrap((_req, res) => {
      c.orgs.rotateApiToken(res.locals.org.id);
      res.redirect("/admin?token_rotated=1");
    }),
  );

  /* ------------------------------ User management ------------------------- */
  function renderUsers(
    res: Response,
    extra: Record<string, unknown> = {},
  ): void {
    const org = res.locals.org;
    res.render("admin_users", {
      title: "Users",
      users: c.users.listForOrg(org.id),
      history: c.userAdminService.history(org.id, 25),
      securityEvents: c.securityEvents.listRecent(15),
      created: null,
      reset: null,
      error: null,
      ...extra,
    });
  }

  router.get(
    "/admin/users",
    requireAdmin(),
    wrap((req, res) => {
      renderUsers(res, { deactivated: req.query.deactivated === "1" });
    }),
  );

  router.post(
    "/admin/users",
    requireAdmin(),
    wrap((req, res) => {
      const org = res.locals.org;
      const role = req.body.role === "admin" ? "admin" : "member";
      try {
        const { user, password } = c.userAdminService.createUser(
          org.id,
          { email: String(req.body.email ?? ""), name: String(req.body.name ?? ""), role },
          { actor: res.locals.actor },
        );
        // Show the one-time password inline (never via redirect/URL).
        renderUsers(res, { created: { email: user.email, password } });
      } catch (err) {
        if (err instanceof ValidationError) {
          res.status(400);
          renderUsers(res, { error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  router.post(
    "/admin/users/:id/deactivate",
    requireAdmin(),
    wrap((req, res) => {
      const org = res.locals.org;
      try {
        c.userAdminService.deactivateUser(org.id, req.params.id!, { actor: res.locals.actor });
        res.redirect("/admin/users?deactivated=1");
      } catch (err) {
        if (err instanceof ValidationError || err instanceof NotFoundError) {
          res.status(err instanceof NotFoundError ? 404 : 400);
          renderUsers(res, { error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  router.post(
    "/admin/users/:id/reset-password",
    requireAdmin(),
    wrap((req, res) => {
      const org = res.locals.org;
      try {
        const { user, password } = c.userAdminService.resetPassword(org.id, req.params.id!, {
          actor: res.locals.actor,
        });
        c.securityEvents.record({
          event: "password_reset",
          email: user.email,
          ip: req.ip ?? null,
          org_id: org.id,
          actor: res.locals.actor,
        });
        renderUsers(res, { reset: { email: user.email, password } });
      } catch (err) {
        if (err instanceof ValidationError || err instanceof NotFoundError) {
          res.status(err instanceof NotFoundError ? 404 : 400);
          renderUsers(res, { error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  router.post(
    "/admin/subscription",
    requireAdmin(),
    wrap((req, res) => {
      const org = res.locals.org;
      const change: {
        plan?: (typeof PLANS)[number];
        subscription_status?: (typeof SUBSCRIPTION_STATUSES)[number];
        data_sharing_opt_in?: boolean;
      } = {};
      // Only accept valid enum values — a crafted POST cannot store garbage.
      if ((PLANS as readonly string[]).includes(req.body.plan)) {
        change.plan = req.body.plan;
      }
      if ((SUBSCRIPTION_STATUSES as readonly string[]).includes(req.body.subscription_status)) {
        change.subscription_status = req.body.subscription_status;
      }
      change.data_sharing_opt_in = req.body.data_sharing_opt_in === "on";
      const reason =
        typeof req.body.reason === "string" && req.body.reason.trim()
          ? req.body.reason.trim()
          : null;
      c.subscriptionService.updateSubscription(org.id, change, {
        actor: res.locals.actor,
        reason,
      });
      res.redirect("/admin?subscription=1");
    }),
  );

  /* --------------------------------- Exports ------------------------------ */
  router.get(
    "/exports/grants.csv",
    wrap((_req, res) => {
      const org = res.locals.org;
      const csv = c.exportService.portfolioCsv(org.id);
      c.usage.record({ org_id: org.id, kind: "export_csv", actor: res.locals.actor });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="grantguard-portfolio-${todayIso()}.csv"`,
      );
      res.send(csv);
    }),
  );

  router.get(
    "/exports/grants.json",
    wrap((_req, res) => {
      const org = res.locals.org;
      // Full structured JSON export is a premium feature (the customer's
      // portable proprietary dataset).
      if (!can(org, "jsonExport")) {
        res.status(402).render("upgrade", {
          title: "Premium export",
          feature: "the full JSON portfolio export",
          message: "Upgrade to export your complete structured dataset (grants, tasks, and outcomes).",
        });
        return;
      }
      const data = c.exportService.portfolioJson(org.id);
      c.usage.record({ org_id: org.id, kind: "export_json", actor: res.locals.actor });
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="grantguard-portfolio-${todayIso()}.json"`,
      );
      res.send(JSON.stringify(data, null, 2));
    }),
  );

  app.use(router);
}
