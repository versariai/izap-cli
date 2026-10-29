import { describe, expect, it } from "vitest";

import { assertFlags, intFlag, parseArgs } from "../src/args.js";
import { CliError } from "../src/errors.js";

function usageFailure(fn: () => unknown): CliError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).kind).toBe("usage");
    return error as CliError;
  }
  throw new Error("expected a usage error");
}

describe("parseArgs", () => {
  it("splits positionals, boolean flags and string flags", () => {
    expect(parseArgs(["chats", "list", "--json", "--page", "2", "--kind=all"])).toEqual({
      flags: { json: true, page: "2", kind: "all" },
      positionals: ["chats", "list"],
    });
  });

  it("never lets a boolean flag swallow the next positional", () => {
    expect(parseArgs(["--json", "transmissions", "show", "t1"]).positionals).toEqual([
      "transmissions",
      "show",
      "t1",
    ]);
  });

  it("gives a string flag the next token even when it starts with a single dash", () => {
    expect(parseArgs(["--text", "- item one"]).flags.text).toBe("- item one");
    expect(parseArgs(["--text=--literal"]).flags.text).toBe("--literal");
  });

  it("supports short flags, --flag=false and the -- terminator", () => {
    expect(parseArgs(["-hy"]).flags).toEqual({ help: true, yes: true });
    expect(parseArgs(["--json=false"]).flags.json).toBe(false);
    expect(parseArgs(["show", "--", "--not-a-flag"]).positionals).toEqual(["show", "--not-a-flag"]);
  });

  it("rejects unknown flags, missing values and values on boolean flags", () => {
    expect(usageFailure(() => parseArgs(["--nope"])).message).toBe("Unknown flag: --nope");
    expect(usageFailure(() => parseArgs(["-x"])).message).toBe("Unknown flag: -x");
    expect(usageFailure(() => parseArgs(["--chat"])).message).toBe("--chat needs a value.");
    expect(usageFailure(() => parseArgs(["--text", "--yes"])).message).toBe("--text needs a value.");
    expect(usageFailure(() => parseArgs(["--json=yes"])).message).toBe("--json does not take a value.");
  });
});

describe("assertFlags", () => {
  it("accepts global flags and the command's own flags", () => {
    expect(() =>
      assertFlags({ json: true, profile: "p", page: "1" }, ["page"], "chats list"),
    ).not.toThrow();
  });

  it("rejects another command's flag", () => {
    const error = usageFailure(() => assertFlags({ yes: true }, ["page"], "chats list"));
    expect(error.message).toBe("--yes is not a flag of `izap chats list`.");
  });
});

describe("intFlag", () => {
  it("parses whole numbers within range", () => {
    expect(intFlag({ page: "3" }, "page", { min: 1 })).toBe(3);
    expect(intFlag({}, "page", { min: 1 })).toBeUndefined();
  });

  it("rejects non-integers and out-of-range values", () => {
    usageFailure(() => intFlag({ page: "0" }, "page", { min: 1 }));
    usageFailure(() => intFlag({ page: "1.5" }, "page", { min: 1 }));
    usageFailure(() => intFlag({ "page-size": "101" }, "page-size", { min: 1, max: 100 }));
  });
});
