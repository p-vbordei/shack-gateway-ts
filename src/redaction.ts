/**
 * Sensitive-field redaction for log output.
 *
 * {@link Redactor} walks any JSON-compatible value and replaces the values of
 * nominated field names with a fixed mask string. Matching is
 * case-insensitive and applied recursively through nested objects and arrays.
 * Only field *names* are checked — values are never inspected for secrets.
 *
 * This ensures credentials (tokens, passwords, API keys, etc.) never appear
 * in the gateway's stderr log trace even when arguments are logged for
 * debugging.
 */

export const MASK = "***REDACTED***";

export class Redactor {
  private fields: Set<string>;

  constructor(fields: string[]) {
    this.fields = new Set(fields.map((f) => f.toLowerCase()));
  }

  redact(value: unknown): unknown {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = this.fields.has(k.toLowerCase()) ? MASK : this.redact(v);
      }
      return out;
    } else if (Array.isArray(value)) {
      return value.map((item) => this.redact(item));
    }
    return value;
  }
}
