import { assertNoArgs, stringFlag } from "../args.js";
import type { OAuthSession, Profile } from "../config.js";
import type { Context } from "../context.js";
import { usageError } from "../errors.js";
import { browserLogin, revokeSession } from "../oauth.js";
import type { Command } from "./types.js";

const TOKEN_PREFIXES = ["izap_pat_", "izap_sk_"];
const CREATE_TOKEN_HINT =
  "Create a personal access token in the iZap dashboard under User Settings → API Keys, then run `izap login`.";

export const login: Command = {
  name: "login",
  summary: "Save a personal access token, or log in with --browser",
  flags: ["token", "browser"],
  help: `Usage: izap login [--token <token> | --browser] [flags]

Saves a credential for a profile in $XDG_CONFIG_HOME/izap/config.json
(default ~/.config/izap/config.json), readable only by you.

Without --token, the token comes from IZAP_TOKEN, a hidden prompt, or stdin
(izap login < token.txt). Create a personal access token in the iZap dashboard
under User Settings → API Keys; API keys come with plans that include the REST API.

Flags
  --token <token>     The token to save (it can end up in your shell history)
  --browser           Log in through the browser instead (OAuth 2.0 with PKCE)
  --business <id>     Also save a default business for this profile
  --staging           Save the staging API (https://api-staging.izap.ai) for this profile
  --base-url <url>    Save another API origin for this profile
  --profile <name>    Profile to save to (default: "default")`,

  async run(ctx, args) {
    assertNoArgs(args, "login");
    const tokenFlag = stringFlag(ctx.flags, "token");
    const browser = ctx.flags.browser === true;
    if (browser && tokenFlag !== undefined) {
      throw usageError("Pass either --browser or --token, not both.");
    }

    const previous = ctx.profile ?? {};
    const profile: Profile = { ...previous, baseUrl: ctx.baseUrl };
    if (stringFlag(ctx.flags, "business") !== undefined) profile.businessId = ctx.businessId;

    let saved: string;
    if (browser) {
      const session = await browserLogin({
        baseUrl: ctx.baseUrl,
        previous: previous.oauth,
        fetch: ctx.deps.fetch,
        openBrowser: ctx.deps.openBrowser,
        notify: (text) => ctx.out.note(text),
        now: ctx.deps.now,
        timeoutMs: ctx.deps.loginTimeoutMs,
      });
      ctx.out.addSecret(session.accessToken);
      ctx.out.addSecret(session.refreshToken);
      delete profile.token;
      profile.oauth = session;
      saved = session.accessToken!;
    } else {
      saved = await readToken(ctx, tokenFlag);
      profile.token = saved;
      if (profile.oauth) profile.oauth = withoutTokens(profile.oauth);
    }
    ctx.saveProfile(profile);

    if (ctx.out.json) {
      ctx.out.data({
        profile: ctx.profileName,
        baseUrl: ctx.baseUrl,
        businessId: profile.businessId ?? null,
        credential: browser ? "oauth" : "token",
        configPath: ctx.configPath,
      });
    } else {
      ctx.out.line(
        `Logged in to ${ctx.baseUrl} ${browser ? "through the browser" : "with a token"} (profile "${ctx.profileName}").`,
      );
      ctx.out.line(`Saved to ${ctx.configPath}`);
      ctx.out.line(`Check it with: izap whoami${profileArg(ctx)}`);
    }
    const fromEnv = ctx.deps.env.IZAP_TOKEN?.trim();
    if (fromEnv && fromEnv !== saved) {
      ctx.out.note("Note: IZAP_TOKEN is set in this shell, and it takes precedence over the saved credential.");
    }
  },
};

export const logout: Command = {
  name: "logout",
  summary: "Remove the saved credential",
  flags: [],
  help: `Usage: izap logout [--profile <name>]

Removes the token or browser login saved for a profile; a browser login is also
revoked on the server. The profile's API origin and default business are kept.
IZAP_TOKEN, when set, keeps working: unset it yourself.`,

  async run(ctx, args) {
    assertNoArgs(args, "logout");
    const profile = ctx.profile;
    const session = profile?.oauth;
    const removed = Boolean(profile?.token || session?.accessToken || session?.refreshToken);
    if (profile && removed) {
      if (session) await revokeSession(session, ctx.deps.fetch);
      const { token: _token, oauth: _oauth, ...rest } = profile;
      ctx.saveProfile(session ? { ...rest, oauth: withoutTokens(session) } : rest);
    }

    if (ctx.out.json) {
      ctx.out.data({ profile: ctx.profileName, removed });
    } else {
      ctx.out.line(
        removed
          ? `Logged out: removed the saved credential for profile "${ctx.profileName}".`
          : `Profile "${ctx.profileName}" has no saved credential.`,
      );
    }
    if (ctx.deps.env.IZAP_TOKEN?.trim()) {
      ctx.out.note("Note: IZAP_TOKEN is still set in this shell, so commands keep using it.");
    }
  },
};

async function readToken(ctx: Context, flagValue: string | undefined): Promise<string> {
  let raw: string;
  if (flagValue !== undefined) {
    if (ctx.deps.isInteractive()) {
      ctx.out.note("Warning: a token passed with --token can end up in your shell history. Next time, let `izap login` prompt for it.");
    }
    raw = flagValue;
  } else if (ctx.deps.env.IZAP_TOKEN?.trim()) {
    raw = ctx.deps.env.IZAP_TOKEN;
  } else if (ctx.deps.isInteractive()) {
    raw = await ctx.deps.promptSecret("Paste your iZap personal access token (izap_pat_...): ");
  } else {
    raw = await ctx.deps.readStdin();
  }

  const token = raw.trim();
  ctx.out.addSecret(token);
  if (!token) throw usageError("No token given.", CREATE_TOKEN_HINT);
  if (/\s/.test(token)) {
    throw usageError("A token cannot contain spaces.", "Paste only the token (izap_pat_...), without a \"Bearer\" prefix.");
  }
  if (!TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix))) {
    ctx.out.note("Warning: that does not look like an iZap token (personal access tokens start with izap_pat_). Saved anyway; check it with `izap whoami`.");
  }
  return token;
}

function withoutTokens(session: OAuthSession): OAuthSession {
  return {
    clientId: session.clientId,
    tokenEndpoint: session.tokenEndpoint,
    ...(session.revocationEndpoint ? { revocationEndpoint: session.revocationEndpoint } : {}),
  };
}

function profileArg(ctx: Context): string {
  return ctx.profileName === "default" ? "" : ` --profile ${ctx.profileName}`;
}
