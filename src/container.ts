import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db/connection.js";
import { OrganizationRepository } from "./repositories/organizationRepository.js";
import { GrantRepository } from "./repositories/grantRepository.js";
import { TaskRepository } from "./repositories/taskRepository.js";
import { EventRepository } from "./repositories/eventRepository.js";
import { UsageRepository } from "./repositories/usageRepository.js";
import { SubscriptionEventRepository } from "./repositories/subscriptionEventRepository.js";
import { UserRepository } from "./repositories/userRepository.js";
import { UserEventRepository } from "./repositories/userEventRepository.js";
import { SecurityEventRepository } from "./repositories/securityEventRepository.js";
import { GrantService } from "./services/grantService.js";
import { IngestService } from "./services/ingestService.js";
import { ExportService } from "./services/exportService.js";
import { SubscriptionService } from "./services/subscriptionService.js";
import { UserAdminService } from "./services/userAdminService.js";
import { LoginRateLimiter } from "./auth/loginRateLimiter.js";

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
  const subscriptionEvents = new SubscriptionEventRepository(db);
  const users = new UserRepository(db);
  const userEvents = new UserEventRepository(db);
  const securityEvents = new SecurityEventRepository(db);

  const grantService = new GrantService(grants, tasks, events);
  const ingestService = new IngestService(grantService);
  const exportService = new ExportService(grants, tasks, events, orgs);
  const subscriptionService = new SubscriptionService(orgs, subscriptionEvents);
  const userAdminService = new UserAdminService(users, userEvents);
  const loginLimiter = new LoginRateLimiter();

  return {
    db,
    orgs,
    grants,
    tasks,
    events,
    usage,
    subscriptionEvents,
    users,
    userEvents,
    securityEvents,
    grantService,
    ingestService,
    exportService,
    subscriptionService,
    userAdminService,
    loginLimiter,
  };
}

export type Container = ReturnType<typeof createContainer>;
