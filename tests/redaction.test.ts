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
});
