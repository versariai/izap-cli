import type { Flags } from "./args.js";
import {
  configFilePath,
  getProfile,
  loadConfig,
  resolveBaseUrl,
  resolveBusinessId,
  resolveProfileName,
  saveConfig,
  type Profile,
} from "./config.js";
import type { CliDeps } from "./deps.js";
import { CliError, usageError } from "./errors.js";
import type { Output } from "./output.js";

/** What a command runs with: resolved profile, API origin and business, plus its I/O. */
export interface Context {
  readonly deps: CliDeps;
  readonly out: Output;
  readonly flags: Flags;
  readonly profileName: string;
  readonly configPath: string;
  readonly baseUrl: string;
  readonly businessId: string | undefined;
  profile: Profile | undefined;
  saveProfile(profile: Profile): void;
}

export function createContext(deps: CliDeps, flags: Flags, out: Output): Context {
  const profileName = resolveProfileName(flags, deps.env);
  const configPath = configFilePath(deps.env, deps.homedir());
  const { config, readableByOthers } = loadConfig(configPath);
  if (readableByOthers) {
    out.note(`Warning: ${configPath} can be read by other users. Fix it with: chmod 600 "${configPath}"`);
  }
  const profile = getProfile(config, profileName);
  out.addSecret(profile?.token);
  out.addSecret(profile?.oauth?.accessToken);
  out.addSecret(profile?.oauth?.refreshToken);

  const ctx: Context = {
    deps,
    out,
    flags,
    profileName,
    configPath,
    baseUrl: resolveBaseUrl(flags, deps.env, profile),
    businessId: resolveBusinessId(flags, deps.env, profile),
    profile,
    saveProfile(next) {
      config.profiles[profileName] = next;
      saveConfig(configPath, config);
      ctx.profile = next;
    },
  };
  return ctx;
}

export function requireBusiness(ctx: Context): string {
  if (ctx.businessId) return ctx.businessId;
  throw usageError(
    "No business selected.",
    "Pass --business <id>, set IZAP_BUSINESS_ID, or save a default with `izap login --business <id>`.",
  );
}

/** The gate in front of every send: real WhatsApp messages cannot be recalled. */
export async function confirmSend(ctx: Context, question: string): Promise<void> {
  if (ctx.flags.yes === true) return;
  if (!ctx.deps.isInteractive()) {
    throw usageError(
      "Refusing to send without confirmation.",
      "Pass --yes to send from a script or a non-interactive shell.",
    );
  }
  if (!(await ctx.deps.confirm(question))) {
    throw new CliError("cancelled", "Cancelled. Nothing was sent.");
  }
}
