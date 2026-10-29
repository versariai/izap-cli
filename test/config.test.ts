import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  configFilePath,
  loadConfig,
  PRODUCTION_BASE_URL,
  resolveBaseUrl,
  resolveBusinessId,
  resolveProfileName,
  saveConfig,
  STAGING_BASE_URL,
} from "../src/config.js";
import { CliError } from "../src/errors.js";
import { BUSINESS_ID, POSIX, TOKEN } from "./helpers.js";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "izap-cli-config-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("config location", () => {
  it("uses $XDG_CONFIG_HOME/izap/config.json", () => {
    expect(configFilePath({ XDG_CONFIG_HOME: "/xdg" }, "/home/u")).toBe(join("/xdg", "izap", "config.json"));
  });

  it("falls back to ~/.config/izap/config.json, ignoring a relative XDG_CONFIG_HOME", () => {
    const expected = join("/home/u", ".config", "izap", "config.json");
    expect(configFilePath({}, "/home/u")).toBe(expected);
    expect(configFilePath({ XDG_CONFIG_HOME: "relative/dir" }, "/home/u")).toBe(expected);
  });
});

describe("saveConfig / loadConfig", () => {
  it.skipIf(!POSIX)("creates the directory 0700 and the file 0600", () => {
    const path = join(tempDir(), "nested", "izap", "config.json");
    saveConfig(path, { profiles: { default: { token: TOKEN } } });

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    expect(loadConfig(path)).toEqual({
      config: { profiles: { default: { token: TOKEN } } },
      readableByOthers: false,
    });
  });

  it.skipIf(!POSIX)("tightens a loose existing file and directory on the next save", () => {
    const dir = join(tempDir(), "izap");
    mkdirSync(dir, { mode: 0o755 });
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ profiles: {} }));
    chmodSync(path, 0o644);
    expect(loadConfig(path).readableByOthers).toBe(true);

    saveConfig(path, { profiles: { default: { token: TOKEN } } });

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(loadConfig(path).readableByOthers).toBe(false);
  });

  it("treats a missing file as an empty config", () => {
    expect(loadConfig(join(tempDir(), "missing.json")).config).toEqual({ profiles: {} });
  });

  it("reports an unreadable file as a usage error", () => {
    const path = join(tempDir(), "config.json");
    writeFileSync(path, "{not json");
    expect(() => loadConfig(path)).toThrow(CliError);
  });

  it("drops invalid profile names and fields of the wrong type", () => {
    const path = join(tempDir(), "config.json");
    writeFileSync(
      path,
      JSON.stringify({
        profiles: { ok: { token: TOKEN, baseUrl: 42 }, "__proto__": { token: "x" }, "bad name": {} },
      }),
    );
    expect(loadConfig(path).config).toEqual({ profiles: { ok: { token: TOKEN } } });
  });
});

describe("resolution", () => {
  const profile = { baseUrl: "https://profile.example.com", businessId: BUSINESS_ID };

  it("picks the profile from --profile, then IZAP_PROFILE, then default", () => {
    expect(resolveProfileName({ profile: "work" }, { IZAP_PROFILE: "env" })).toBe("work");
    expect(resolveProfileName({}, { IZAP_PROFILE: "env" })).toBe("env");
    expect(resolveProfileName({}, {})).toBe("default");
    expect(() => resolveProfileName({ profile: "../etc" }, {})).toThrow(CliError);
  });

  it("orders the API origin --base-url > --staging > IZAP_BASE_URL > profile > production", () => {
    const env = { IZAP_BASE_URL: "https://env.example.com/" };
    expect(resolveBaseUrl({ "base-url": "http://localhost:8000/" }, env, profile)).toBe("http://localhost:8000");
    expect(resolveBaseUrl({ staging: true }, env, profile)).toBe(STAGING_BASE_URL);
    expect(resolveBaseUrl({}, env, profile)).toBe("https://env.example.com");
    expect(resolveBaseUrl({}, {}, profile)).toBe("https://profile.example.com");
    expect(resolveBaseUrl({}, {}, undefined)).toBe(PRODUCTION_BASE_URL);
  });

  it("refuses plain http outside localhost, and --staging with --base-url", () => {
    expect(() => resolveBaseUrl({ "base-url": "http://api.izap.ai" }, {}, undefined)).toThrow(CliError);
    expect(() => resolveBaseUrl({ "base-url": "https://a.example", staging: true }, {}, undefined)).toThrow(
      CliError,
    );
  });

  it("orders the business --business > IZAP_BUSINESS_ID > profile, and validates it", () => {
    const other = "11111111-0000-4000-8000-000000000000";
    expect(resolveBusinessId({ business: other }, { IZAP_BUSINESS_ID: BUSINESS_ID }, profile)).toBe(other);
    expect(resolveBusinessId({}, { IZAP_BUSINESS_ID: other }, profile)).toBe(other);
    expect(resolveBusinessId({}, {}, profile)).toBe(BUSINESS_ID);
    expect(resolveBusinessId({}, {}, undefined)).toBeUndefined();
    expect(() => resolveBusinessId({ business: "not-a-uuid" }, {}, undefined)).toThrow(CliError);
  });
});
