/**
 * Minimal, dependency-free RFC-4180-ish CSV parser.
 * Handles quoted fields, embedded commas/newlines, and "" escaped quotes.
 * Good enough for spreadsheet exports; no streaming (MVP file sizes).
 */
export function parseCsv(input: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const text = input.replace(/^﻿/, ""); // strip BOM
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // Handle CRLF: skip the \n after a \r
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      // Ignore blank lines
      if (record.length > 1 || record[0] !== "") records.push(record);
      record = [];
    } else {
      field += c;
    }
  }
  // Flush trailing field/record
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    if (record.length > 1 || record[0] !== "") records.push(record);
  }

  if (records.length === 0) return { headers: [], rows: [] };
  const headers = (records[0] ?? []).map((h) => h.trim());
  const rows = records.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? "").trim();
    });
    return obj;
  });
  return { headers, rows };
}

function escapeCsv(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Serialize rows to CSV using an explicit, ordered column list. */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: Array<keyof T & string>,
): string {
  const header = columns.map(escapeCsv).join(",");
  const body = rows.map((r) => columns.map((c) => escapeCsv(r[c])).join(","));
  return [header, ...body].join("\n");
}
