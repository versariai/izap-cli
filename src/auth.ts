import { createClient, type IzapClient } from "@izapai/sdk";

import type { Context } from "./context.js";
import { authError } from "./errors.js";
import { refreshSession } from "./oauth.js";
import { VERSION } from "./version.js";

// Refresh a little early so a token cannot expire between the check and the request.
const REFRESH_MARGIN_MS = 60_000;

export type CredentialSource = "env" | "token" | "oauth";

export interface Credential {
  token: string;
  source: CredentialSource;
}

/** IZAP_TOKEN always wins; then the profile's token; then its browser login (refreshed if due). */
export async function resolveCredential(ctx: Context): Promise<Credential> {
  const fromEnv = ctx.deps.env.IZAP_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: "env" };

  const profile = ctx.profile;
  if (profile?.token) return { token: profile.token, source: "token" };

  const session = profile?.oauth;
  if (profile && session?.accessToken) {
    const now = ctx.deps.now();
    const { expiresAt } = session;
    const fresh = expiresAt !== undefined && now < expiresAt - REFRESH_MARGIN_MS;
    // An unknown expiry counts as due, so the session renews instead of failing later with a 401.
    if (fresh || (expiresAt === undefined && !session.refreshToken)) {
      return { token: session.accessToken, source: "oauth" };
    }
    const refreshed = await refreshSession(session, ctx.deps.fetch, now);
    ctx.out.addSecret(refreshed.accessToken);
    ctx.out.addSecret(refreshed.refreshToken);
    ctx.saveProfile({ ...profile, oauth: refreshed });
    return { token: refreshed.accessToken, source: "oauth" };
  }

  const where = ctx.profileName === "default" ? "" : ` (profile "${ctx.profileName}")`;
  throw authError(
    `Not logged in${where}.`,
    "Run `izap login` (or `izap login --browser`), or set IZAP_TOKEN.",
  );
}

export async function apiClient(ctx: Context): Promise<IzapClient> {
  const { token } = await resolveCredential(ctx);
  return createApiClient(ctx, token);
}

export function createApiClient(ctx: Context, token: string): IzapClient {
  ctx.out.addSecret(token);
  return createClient({
    token,
    baseUrl: ctx.baseUrl,
    businessId: ctx.businessId,
    fetch: withCliUserAgent(ctx.deps.fetch),
  });
}

function withCliUserAgent(fetchImpl: typeof fetch): typeof fetch {
  return (input, init) => {
    const request = new Request(input, init);
    const sdkAgent = request.headers.get("user-agent");
    request.headers.set("user-agent", sdkAgent ? `izap-cli/${VERSION} ${sdkAgent}` : `izap-cli/${VERSION}`);
    return fetchImpl(request);
  };
}
