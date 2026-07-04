import { Router, type Express, type Request, type Response } from "express";
import type { Container } from "../container.js";
import { config } from "../config.js";
import { checkPasswordStrength } from "../auth/passwordPolicy.js";

/**
 * Self-service password change. Used both for the first-login forced change
 * (admin-created / reset accounts) and voluntary changes. Verifies the current
 * password, enforces the strength policy, and clears the must-change flag.
 */
export function registerAccountRoutes(app: Express, c: Container): void {
  const router = Router();

  router.get("/account/password", (_req: Request, res: Response) => {
    const user = res.locals.currentUser;
    if (!user) return res.redirect("/login");
    res.render("account_password", {
      title: "Change password",
      forced: user.must_change_password,
      error: null,
      minLength: config.passwordMinLength,
    });
  });

  router.post("/account/password", (req: Request, res: Response) => {
    const user = res.locals.currentUser;
    if (!user) return res.redirect("/login");

    const render = (error: string, status = 400) =>
      res.status(status).render("account_password", {
        title: "Change password",
        forced: user.must_change_password,
        error,
        minLength: config.passwordMinLength,
      });

    const current = String(req.body.current_password ?? "");
    const next = String(req.body.new_password ?? "");
    const confirm = String(req.body.confirm_password ?? "");

    if (next !== confirm) return render("New passwords do not match.");
    if (!c.users.authenticate(user.email, current)) {
      c.securityEvents.record({
        event: "password_change_failed",
        email: user.email,
        ip: req.ip ?? null,
        detail: "wrong current password",
      });
      return render("Your current password is incorrect.", 401);
    }
    if (next === current) return render("Your new password must be different from the current one.");
    const strength = checkPasswordStrength(next, config.passwordMinLength);
    if (!strength.ok) return render(`Password must ${strength.errors.join(", ")}.`);

    c.users.setPassword(user.id, next, false);
    c.userEvents.append({
      org_id: user.org_id,
      actor: user.email,
      action: "password_changed",
      target_id: user.id,
      target_email: user.email,
      detail: "self-service",
    });
    c.securityEvents.record({
      event: "password_changed",
      email: user.email,
      ip: req.ip ?? null,
      org_id: user.org_id,
      actor: user.email,
    });
    res.redirect("/?password_changed=1");
  });

  app.use(router);
}
