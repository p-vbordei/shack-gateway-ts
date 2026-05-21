/**
 * Sensitive-field redaction for log output.
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
