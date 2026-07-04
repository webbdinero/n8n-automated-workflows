import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { SCHEMA_SQL, ORG_MIGRATION_COLUMNS, USER_MIGRATION_COLUMNS } from "./schema.js";

// `node:sqlite` is an experimental Node 22 builtin that predates bundler
// builtin-module lists (Vite/Vitest try to resolve it as a file and fail).
// Loading it through createRequire keeps it opaque to the bundler while Node
// resolves it natively at runtime.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

let db: DatabaseSyncType | null = null;

/** Apply idempotent schema migrations (add columns missing on older DBs). */
function migrate(conn: DatabaseSyncType): void {
  addMissingColumns(conn, "organizations", ORG_MIGRATION_COLUMNS);
  addMissingColumns(conn, "users", USER_MIGRATION_COLUMNS);
}

function addMissingColumns(
  conn: DatabaseSyncType,
  table: string,
  columns: Array<[string, string]>,
): void {
  const existing = new Set(
    (conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (r) => r.name,
    ),
  );
  for (const [name, ddl] of columns) {
    if (!existing.has(name)) {
      conn.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  }
}

/**
 * Returns a process-wide singleton SQLite connection, creating the database
 * file and schema on first use. `node:sqlite` ships with Node 22+, so there is
 * no native module to compile.
 *
 * The whole app talks to SQLite only through the repository layer, so swapping
 * this for Postgres later is a localized change.
 */
export function getDb(): DatabaseSyncType {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  db = new DatabaseSync(config.databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA_SQL);
  migrate(db);
  return db;
}

/** For tests: open an isolated in-memory database with the schema applied. */
export function openMemoryDb(): DatabaseSyncType {
  const mem = new DatabaseSync(":memory:");
  mem.exec("PRAGMA foreign_keys = ON;");
  mem.exec(SCHEMA_SQL);
  migrate(mem);
  return mem;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
