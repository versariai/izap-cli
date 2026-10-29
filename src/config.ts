import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import { DEFAULT_BASE_URL } from "@izapai/sdk";

import { stringFlag, type Flags } from "./args.js";
import { CliError, usageError } from "./errors.js";

export const PRODUCTION_BASE_URL = DEFAULT_BASE_URL;
export const STAGING_BASE_URL = "https://api-staging.izap.ai";
export const DEFAULT_PROFILE = "default";

/** A browser (OAuth) login. The client registration survives `izap logout` so it can be reused. */
export interface OAuthSession {
  clientId: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Access-token expiry, epoch milliseconds. */
  expiresAt?: number;
}

export interface Profile {
  baseUrl?: string;
  businessId?: string;
  /** Personal access token (`izap_pat_…`). */
  token?: string;
  oauth?: OAuthSession;
}

export interface Config {
  profiles: Record<string, Profile>;
}

const POSIX = process.platform !== "win32";
// Starts with a letter or digit, so names like `__proto__` can never be a profile key.
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function configDir(env: Readonly<Record<string, string | undefined>>, home: string): string {
  const xdg = env.XDG_CONFIG_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(home, ".config"), "izap");
}

export function configFilePath(env: Readonly<Record<string, string | undefined>>, home: string): string {
  return join(configDir(env, home), "config.json");
}

export interface LoadedConfig {
  config: Config;
  /** True when group or others can read the file (POSIX only). */
  readableByOthers: boolean;
}

export function loadConfig(path: string): LoadedConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: { profiles: {} }, readableByOthers: false };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalidConfig(path, "is not valid JSON");
  }
  if (!isRecord(parsed) || !isRecord(parsed.profiles)) {
    throw invalidConfig(path, "has no `profiles` object");
  }

  const profiles: Record<string, Profile> = {};
  for (const [name, value] of Object.entries(parsed.profiles)) {
    if (PROFILE_NAME.test(name) && isRecord(value)) profiles[name] = readProfile(value);
  }
  const readableByOthers = POSIX && (statSync(path).mode & 0o077) !== 0;
  return { config: { profiles }, readableByOthers };
}

/** Writes the config atomically: dir 0700, file 0600, never briefly world-readable. */
export function saveConfig(path: string, config: Config): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (POSIX) chmodSync(dir, 0o700);

  const temp = join(dir, `.config.json.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try {
    if (POSIX) chmodSync(temp, 0o600);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function getProfile(config: Config, name: string): Profile | undefined {
  return Object.hasOwn(config.profiles, name) ? config.profiles[name] : undefined;
}

export function resolveProfileName(flags: Flags, env: Readonly<Record<string, string | undefined>>): string {
  const name = stringFlag(flags, "profile") ?? (env.IZAP_PROFILE || DEFAULT_PROFILE);
  if (!PROFILE_NAME.test(name)) {
    throw usageError(
      `Invalid profile name: ${name}`,
      "Use letters, digits, '.', '_' or '-' (up to 64 characters), starting with a letter or digit.",
    );
  }
  return name;
}

/** --base-url, then --staging, then IZAP_BASE_URL, then the profile, then production. */
export function resolveBaseUrl(
  flags: Flags,
  env: Readonly<Record<string, string | undefined>>,
  profile: Profile | undefined,
): string {
  const flag = stringFlag(flags, "base-url");
  if (flag !== undefined && flags.staging === true) {
    throw usageError("Pass either --staging or --base-url, not both.");
  }
  if (flag !== undefined) return normalizeBaseUrl(flag, "--base-url");
  if (flags.staging === true) return STAGING_BASE_URL;
  if (env.IZAP_BASE_URL) return normalizeBaseUrl(env.IZAP_BASE_URL, "IZAP_BASE_URL");
  if (profile?.baseUrl) return normalizeBaseUrl(profile.baseUrl, "The profile's baseUrl");
  return PRODUCTION_BASE_URL;
}

/** --business, then IZAP_BUSINESS_ID, then the profile's default. */
export function resolveBusinessId(
  flags: Flags,
  env: Readonly<Record<string, string | undefined>>,
  profile: Profile | undefined,
): string | undefined {
  const flag = stringFlag(flags, "business");
  if (flag !== undefined) return assertBusinessId(flag, "--business");
  if (env.IZAP_BUSINESS_ID) return assertBusinessId(env.IZAP_BUSINESS_ID, "IZAP_BUSINESS_ID");
  return profile?.businessId;
}

export function assertBusinessId(value: string, source: string): string {
  const trimmed = value.trim();
  if (!UUID.test(trimmed)) {
    throw usageError(`${source} must be a business UUID, got: ${value}`);
  }
  return trimmed.toLowerCase();
}

// Tokens must never travel over plain http, except to a local dev server.
export function normalizeBaseUrl(value: string, source: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw usageError(`${source} is not a valid URL: ${value}`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw usageError(`${source} must use https:// (plain http:// is allowed only for localhost).`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw usageError(`${source} must be a plain origin such as ${PRODUCTION_BASE_URL}.`);
  }
  return url.toString().replace(/\/+$/, "");
}

function readProfile(value: Record<string, unknown>): Profile {
  const profile: Profile = {};
  if (typeof value.baseUrl === "string") profile.baseUrl = value.baseUrl;
  if (typeof value.businessId === "string") profile.businessId = value.businessId;
  if (typeof value.token === "string") profile.token = value.token;
  const oauth = value.oauth;
  if (isRecord(oauth) && typeof oauth.clientId === "string" && typeof oauth.tokenEndpoint === "string") {
    profile.oauth = { clientId: oauth.clientId, tokenEndpoint: oauth.tokenEndpoint };
    if (typeof oauth.revocationEndpoint === "string") profile.oauth.revocationEndpoint = oauth.revocationEndpoint;
    if (typeof oauth.accessToken === "string") profile.oauth.accessToken = oauth.accessToken;
    if (typeof oauth.refreshToken === "string") profile.oauth.refreshToken = oauth.refreshToken;
    if (typeof oauth.expiresAt === "number") profile.oauth.expiresAt = oauth.expiresAt;
  }
  return profile;
}

function invalidConfig(path: string, problem: string): CliError {
  return usageError(
    `The config file ${path} ${problem}.`,
    "Fix it, or delete it and run `izap login` again.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
