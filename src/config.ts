import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project root, resolved relative to this compiled/loaded file. */
export const ROOT_DIR = path.resolve(__dirname, "..");

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

const nodeEnv = process.env.NODE_ENV ?? "development";

// A stable SESSION_SECRET keeps sessions valid across restarts. If unset we
// generate an ephemeral one (dev convenience) and flag it so boot can warn.
const sessionSecretFromEnv = process.env.SESSION_SECRET;

export const config = {
  port: envInt("PORT", 3000),
  databasePath: path.resolve(
    ROOT_DIR,
    process.env.DATABASE_PATH ?? "data/grantguard.db",
  ),
  defaultOrgSlug: process.env.DEFAULT_ORG_SLUG ?? "demo-borough",
  nodeEnv,
  sessionSecret: sessionSecretFromEnv ?? randomBytes(32).toString("hex"),
  sessionSecretIsEphemeral: !sessionSecretFromEnv,
  cookieSecure: nodeEnv === "production",
  passwordMinLength: envInt("PASSWORD_MIN_LENGTH", 10),
  // Multi-instance seam (NOT implemented yet). When set, the login rate
  // limiter and session store should be backed by Redis so throttling and
  // sessions are shared across instances. See docs/PRODUCTION_AUTH.md.
  // TODO(redis): back LoginRateLimiter + sessions with this when scaling out.
  redisUrl: process.env.REDIS_URL ?? null,
  viewsDir: path.join(ROOT_DIR, "src", "views"),
  publicDir: path.join(ROOT_DIR, "src", "public"),
} as const;

export type Config = typeof config;
