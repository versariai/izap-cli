import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { cell, table } from "../src/format.js";
import { redact } from "../src/redact.js";
import { VERSION } from "../src/version.js";

describe("redact", () => {
  it("removes iZap tokens, bearer credentials and JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";
    expect(redact("token izap_pat_AbC-12_x and izap_sk_zzz")).toBe("token [REDACTED] and [REDACTED]");
    expect(redact("Authorization: Bearer abc.def")).toBe("Authorization: Bearer [REDACTED]");
    expect(redact(`session ${jwt}`)).toBe("session [REDACTED]");
  });

  it("removes known secrets of any shape", () => {
    expect(redact("oops some-opaque-refresh-token here", ["some-opaque-refresh-token"])).toBe(
      "oops [REDACTED] here",
    );
  });
});

describe("cell and table", () => {
  it("strips control characters and truncates", () => {
    expect(cell("hi\u001b[31m there\nfriend")).toBe("hi [31m there friend");
    expect(cell("abcdefghij", 5)).toBe("abcd…");
    expect(cell(null)).toBe("-");
  });

  it("aligns columns", () => {
    expect(table(["ID", "NAME"], [["1", "a"], ["22", "bb"]])).toBe("ID  NAME\n1   a\n22  bb");
  });
});

it("VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  expect(VERSION).toBe(pkg.version);
});
