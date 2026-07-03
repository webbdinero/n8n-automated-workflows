import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db/connection.js";
import { OrganizationRepository } from "./repositories/organizationRepository.js";
import { GrantRepository } from "./repositories/grantRepository.js";
import { TaskRepository } from "./repositories/taskRepository.js";
import { EventRepository } from "./repositories/eventRepository.js";
import { UsageRepository } from "./repositories/usageRepository.js";
import { GrantService } from "./services/grantService.js";
import { IngestService } from "./services/ingestService.js";
import { ExportService } from "./services/exportService.js";

/**
 * Composition root. Wires repositories and services over a single SQLite
 * connection. Pass an explicit db (e.g. an in-memory one) for tests.
 */
export function createContainer(db: DatabaseSync = getDb()) {
  const orgs = new OrganizationRepository(db);
  const grants = new GrantRepository(db);
  const tasks = new TaskRepository(db);
  const events = new EventRepository(db);
  const usage = new UsageRepository(db);

  const grantService = new GrantService(grants, tasks, events);
  const ingestService = new IngestService(grantService);
  const exportService = new ExportService(grants, tasks, events, orgs);

  return {
    db,
    orgs,
    grants,
    tasks,
    events,
    usage,
    grantService,
    ingestService,
    exportService,
  };
}

export type Container = ReturnType<typeof createContainer>;
