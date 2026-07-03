import { daysBetween, todayIso } from "../util/dates.js";
import {
  CLASSIFICATIONS,
  FUNDING_SOURCE_LABELS,
  type RiskTier,
} from "../domain/constants.js";

/** View formatters exposed to every EJS template via app.locals. */

export function fmtMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function fmtMoneyExact(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtPct(fraction: number | null | undefined): string {
  return `${Math.round((fraction ?? 0) * 100)}%`;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const day = d.slice(0, 10);
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return day;
  return new Date(t).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  const t = Date.parse(d);
  if (Number.isNaN(t)) return String(d);
  return new Date(t).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** "in 42 days" / "12 days ago" relative to today, from an ISO date. */
export function relativeDays(date: string | null | undefined): string {
  if (!date) return "";
  const d = daysBetween(todayIso(), date);
  if (!Number.isFinite(d)) return "";
  if (d === 0) return "today";
  if (d > 0) return `in ${d} day${d === 1 ? "" : "s"}`;
  return `${Math.abs(d)} day${d === -1 ? "" : "s"} ago`;
}

export function daysTo(date: string | null | undefined): number {
  if (!date) return NaN;
  return daysBetween(todayIso(), date);
}

export function humanize(s: string | null | undefined): string {
  if (!s) return "—";
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function fundingLabel(source: string): string {
  return (FUNDING_SOURCE_LABELS as Record<string, string>)[source] ?? humanize(source);
}

export function tierClass(tier: RiskTier | string): string {
  return `tier-${tier}`;
}

export function classificationLabel(c: string): string {
  return (CLASSIFICATIONS as readonly string[]).includes(c) ? humanize(c) : humanize(c);
}

export const formatHelpers = {
  fmtMoney,
  fmtMoneyExact,
  fmtPct,
  fmtDate,
  fmtDateTime,
  relativeDays,
  daysTo,
  humanize,
  fundingLabel,
  tierClass,
  classificationLabel,
};
