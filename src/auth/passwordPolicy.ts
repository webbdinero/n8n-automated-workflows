/**
 * Minimal password-strength policy for user-chosen passwords (first-login
 * change and reset). Deliberately dependency-free; a zxcvbn-style estimator can
 * be swapped in behind this same function later without touching callers.
 * Admin-generated one-time passwords are high-entropy random and bypass this.
 */
export interface PasswordCheck {
  ok: boolean;
  errors: string[];
}

const COMMON = new Set([
  "password",
  "password1",
  "12345678",
  "123456789",
  "qwerty123",
  "letmein",
  "changeme",
  "grantguard",
  "grantguard-pilot",
  "welcome1",
]);

export function checkPasswordStrength(password: string, minLength = 10): PasswordCheck {
  const errors: string[] = [];
  if (password.length < minLength) {
    errors.push(`be at least ${minLength} characters`);
  }
  const classes =
    (/[a-z]/.test(password) ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0);
  if (classes < 2) {
    errors.push("mix letters with at least one number or symbol");
  }
  if (COMMON.has(password.toLowerCase())) {
    errors.push("not be a commonly used password");
  }
  return { ok: errors.length === 0, errors };
}
