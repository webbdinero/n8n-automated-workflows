import { describe, it, expect } from "vitest";
import { parseCsv, toCsv } from "../src/services/csv.js";
import { mapRawGrant, normalizeDate } from "../src/services/ingestService.js";
import { newCtx } from "./support.js";

describe("parseCsv", () => {
  it("parses headers and rows", () => {
    const { headers, rows } = parseCsv("a,b\n1,2\n3,4");
    expect(headers).toEqual(["a", "b"]);
    expect(rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("handles quoted fields with commas, quotes, and newlines", () => {
    const csv = 'name,note\n"Smith, J.","said ""hi"""\n"multi\nline","ok"';
    const { rows } = parseCsv(csv);
    expect(rows[0]).toEqual({ name: "Smith, J.", note: 'said "hi"' });
    expect(rows[1]).toEqual({ name: "multi\nline", note: "ok" });
  });

  it("ignores trailing blank lines", () => {
    const { rows } = parseCsv("a\n1\n\n");
    expect(rows).toEqual([{ a: "1" }]);
  });
});

describe("toCsv", () => {
  it("serializes and escapes", () => {
    const out = toCsv([{ a: "x,y", b: 3 }], ["a", "b"]);
    expect(out).toBe('a,b\n"x,y",3');
  });
});

describe("normalizeDate", () => {
  it("passes through ISO", () => {
    expect(normalizeDate("2024-06-01")).toBe("2024-06-01");
  });
  it("converts US M/D/YYYY", () => {
    expect(normalizeDate("6/1/2024")).toBe("2024-06-01");
    expect(normalizeDate("12/31/2026")).toBe("2026-12-31");
  });
  it("returns undefined for empty", () => {
    expect(normalizeDate("")).toBeUndefined();
  });
});

describe("mapRawGrant", () => {
  it("maps aliased headers to canonical fields and normalizes", () => {
    const mapped = mapRawGrant({
      "Grant #": "SLFRF-1",
      "Project Name": "Water Project",
      "Funding Source": "ARPA",
      "Award Amount": "$1,250,000",
      Awarded: "3/1/2023",
      "Spend By": "12/31/2026",
      Owner: "J. Rivera",
    });
    expect(mapped.grant_number).toBe("SLFRF-1");
    expect(mapped.title).toBe("Water Project");
    expect(mapped.funding_source).toBe("ARPA_SLFRF");
    expect(mapped.award_date).toBe("2023-03-01");
    expect(mapped.expenditure_deadline).toBe("2026-12-31");
    expect(mapped.assigned_to).toBe("J. Rivera");
  });
});

describe("IngestService", () => {
  const CSV = [
    "grant_number,title,funding_source,award_amount,award_date,expenditure_deadline",
    "A-1,Alpha,ARPA_SLFRF,100000,2023-01-01,2026-12-31",
    "A-2,Beta,CDBG,200000,2023-01-01,2027-06-30",
  ].join("\n");

  it("creates grants from CSV", () => {
    const { c, org } = newCtx();
    const res = c.ingestService.ingestCsv(org.id, CSV, { actor: "t", source: "csv" });
    expect(res.created).toBe(2);
    expect(res.failed).toBe(0);
    expect(c.grants.listAll(org.id)).toHaveLength(2);
  });

  it("skips duplicates on re-import", () => {
    const { c, org } = newCtx();
    c.ingestService.ingestCsv(org.id, CSV, { actor: "t", source: "csv" });
    const second = c.ingestService.ingestCsv(org.id, CSV, { actor: "t", source: "csv" });
    expect(second.created).toBe(0);
    expect(second.duplicates).toBe(2);
  });

  it("reports validation failures with row numbers", () => {
    const { c, org } = newCtx();
    const bad = "grant_number,title,award_amount,award_date,expenditure_deadline\n,No Number,100,2023-01-01,2026-12-31";
    const res = c.ingestService.ingestCsv(org.id, bad, { actor: "t", source: "csv" });
    expect(res.created).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.errors[0]?.row).toBe(1);
  });

  it("ingests a JSON array", () => {
    const { c, org } = newCtx();
    const json = JSON.stringify([
      { grant_number: "J-1", title: "Json One", award_amount: 5000, award_date: "2024-01-01", expenditure_deadline: "2026-12-31" },
    ]);
    const res = c.ingestService.ingestJson(org.id, json, { actor: "t", source: "json" });
    expect(res.created).toBe(1);
  });
});
