import { describe, test, expect } from "@jest/globals";
import { Redactor, MASK } from "../src/redaction.js";

describe("Redactor", () => {
  function redactor() {
    return new Redactor(["token", "password"]);
  }

  test("masks top-level sensitive fields", () => {
    const out = redactor().redact({ token: "abc123", path: "src/main.ts" }) as Record<
      string,
      unknown
    >;
    expect(out["token"]).toBe(MASK);
    expect(out["path"]).toBe("src/main.ts");
  });

  test("masks nested and case-insensitive", () => {
    const out = redactor().redact({
      outer: { Password: "hunter2", ok: 1 },
      list: [{ TOKEN: "t" }],
    }) as Record<string, unknown>;
    const outer = out["outer"] as Record<string, unknown>;
    expect(outer["Password"]).toBe(MASK);
    expect(outer["ok"]).toBe(1);
    const list = out["list"] as Array<Record<string, unknown>>;
    expect(list[0]["TOKEN"]).toBe(MASK);
  });

  test("unaffected values are preserved", () => {
    const inp = { count: 3, items: ["a", "b"] };
    expect(redactor().redact(inp)).toEqual(inp);
  });

  test("null and boolean values preserved", () => {
    const inp = { active: true, value: null, score: 3.14 };
    expect(redactor().redact(inp)).toEqual(inp);
  });

  test("empty object preserved", () => {
    expect(redactor().redact({})).toEqual({});
  });

  test("scalar not in object returned unchanged", () => {
    expect(redactor().redact(42)).toBe(42);
    expect(redactor().redact("hello")).toBe("hello");
  });

  test("deeply nested sensitive field is masked", () => {
    const out = redactor().redact({
      level1: { level2: { token: "deep_secret", safe: "visible" } },
    }) as Record<string, unknown>;
    const l1 = out["level1"] as Record<string, unknown>;
    const l2 = l1["level2"] as Record<string, unknown>;
    expect(l2["token"]).toBe(MASK);
    expect(l2["safe"]).toBe("visible");
  });

  test("array at top level redacted recursively", () => {
    const out = redactor().redact([{ password: "p1" }, { other: "ok" }]) as Array<
      Record<string, unknown>
    >;
    expect(out[0]["password"]).toBe(MASK);
    expect(out[1]["other"]).toBe("ok");
  });

  test("no fields configured leaves everything intact", () => {
    const r = new Redactor([]);
    const inp = { token: "abc", password: "secret" };
    expect(r.redact(inp)).toEqual(inp);
  });

  test("case-insensitive matching for all variants", () => {
    const r = new Redactor(["token"]);
    for (const key of ["TOKEN", "Token", "tOkEn"]) {
      const out = r.redact({ [key]: "secret" }) as Record<string, unknown>;
      expect(out[key]).toBe(MASK);
    }
  });
});
