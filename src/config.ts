import { fileURLToPath } from "node:url";
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

export const config = {
  port: envInt("PORT", 3000),
  databasePath: path.resolve(
    ROOT_DIR,
    process.env.DATABASE_PATH ?? "data/grantguard.db",
  ),
  defaultOrgSlug: process.env.DEFAULT_ORG_SLUG ?? "demo-borough",
  nodeEnv: process.env.NODE_ENV ?? "development",
  viewsDir: path.join(ROOT_DIR, "src", "views"),
  publicDir: path.join(ROOT_DIR, "src", "public"),
} as const;

export type Config = typeof config;
