import { test, expect, describe, afterEach } from "bun:test";
import { resolveToken, UserError } from "../src/cli";

const realToken = process.env.HCLOUD_TOKEN;

afterEach(() => {
  if (realToken === undefined) delete process.env.HCLOUD_TOKEN;
  else process.env.HCLOUD_TOKEN = realToken;
});

describe("resolveToken", () => {
  test("flag wins over env", () => {
    process.env.HCLOUD_TOKEN = "from-env";
    expect(resolveToken("from-flag")).toBe("from-flag");
  });

  test("falls back to HCLOUD_TOKEN", () => {
    process.env.HCLOUD_TOKEN = "from-env";
    expect(resolveToken()).toBe("from-env");
  });

  test("throws UserError when neither is set", () => {
    delete process.env.HCLOUD_TOKEN;
    expect(() => resolveToken()).toThrow(UserError);
  });

  test("empty flag value is treated as missing", () => {
    delete process.env.HCLOUD_TOKEN;
    expect(() => resolveToken("")).toThrow(UserError);
  });
});
