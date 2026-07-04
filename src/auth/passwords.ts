import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt (memory-hard, in Node core — no dependency).
 * Stored format: `scrypt$<saltHex>$<hashHex>`. Plaintext is never stored.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  if (expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
  // Lengths always match here, but guard before the constant-time compare.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
