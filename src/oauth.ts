import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { OAuthSession } from "./config.js";
import { authError, CliError } from "./errors.js";

// Registered without a port: the server matches loopback redirects on everything but
// the port (RFC 8252 §7.3), so each login can listen on a fresh random port.
export const REGISTERED_REDIRECT_URI = "http://127.0.0.1/callback";
export const LOGIN_TIMEOUT_MS = 5 * 60_000;
const HTTP_TIMEOUT_MS = 30_000;
const RELOGIN_HINT = "Run `izap login --browser` again, or log in with a token: `izap login`.";

export interface AuthorizationServer {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint?: string;
}

export interface BrowserLoginOptions {
  baseUrl: string;
  /** A previous session whose client registration can be reused. */
  previous?: OAuthSession;
  fetch: typeof fetch;
  openBrowser: (url: string) => void;
  notify: (text: string) => void;
  now: () => number;
  timeoutMs: number;
}

/** OAuth 2.0 authorization code + PKCE (S256) with a loopback redirect, as a public client. */
export async function browserLogin(options: BrowserLoginOptions): Promise<OAuthSession> {
  const server = await discoverAuthorizationServer(options.baseUrl, options.fetch);
  const reusable = options.previous?.tokenEndpoint === server.tokenEndpoint;
  const clientId = reusable ? options.previous!.clientId : await registerClient(server, options.fetch);

  const pkce = createPkcePair();
  const state = randomBytes(16).toString("base64url");
  const listener = await listenForCallback(state, options.timeoutMs);
  try {
    const url = new URL(server.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", listener.redirectUri);
    url.searchParams.set("code_challenge", pkce.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);

    options.notify(
      `Opening your browser to log in to iZap. If it does not open, visit:\n\n  ${url}\n\nWaiting for the login to finish (Ctrl-C to cancel)...`,
    );
    try {
      options.openBrowser(url.toString());
    } catch {
      // The URL is printed above.
    }

    const code = await listener.code;
    const tokens = await requestTokens(
      options.fetch,
      server.tokenEndpoint,
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: listener.redirectUri,
        client_id: clientId,
        code_verifier: pkce.verifier,
      },
      "the login",
    );
    return {
      clientId,
      tokenEndpoint: server.tokenEndpoint,
      ...(server.revocationEndpoint ? { revocationEndpoint: server.revocationEndpoint } : {}),
      accessToken: tokens.accessToken,
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      ...expiry(tokens.expiresIn, options.now()),
    };
  } finally {
    listener.close();
  }
}

/** Trades the refresh token for a new access + refresh token pair (the server rotates it). */
export async function refreshSession(
  session: OAuthSession,
  fetchImpl: typeof fetch,
  now: number,
): Promise<OAuthSession & { accessToken: string }> {
  if (!session.refreshToken) {
    throw authError("Your browser login has expired.", RELOGIN_HINT);
  }
  const tokens = await requestTokens(
    fetchImpl,
    session.tokenEndpoint,
    { grant_type: "refresh_token", refresh_token: session.refreshToken, client_id: session.clientId },
    "the session refresh",
  );
  const { expiresAt: _previousExpiry, ...rest } = session;
  return {
    ...rest,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? session.refreshToken,
    ...expiry(tokens.expiresIn, now),
  };
}

/** Best effort: revokes the refresh-token family and the access token. Never throws. */
export async function revokeSession(session: OAuthSession, fetchImpl: typeof fetch): Promise<void> {
  const endpoint = session.revocationEndpoint;
  if (!endpoint) return;
  const revoke = async (token: string, hint: string) => {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, token_type_hint: hint, client_id: session.clientId }).toString(),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      await response.body?.cancel().catch(() => undefined);
    } catch {
      // Logging out still removes the local copy.
    }
  };
  if (session.refreshToken) await revoke(session.refreshToken, "refresh_token");
  if (session.accessToken) await revoke(session.accessToken, "access_token");
}

export async function discoverAuthorizationServer(
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<AuthorizationServer> {
  const origin = new URL(baseUrl).origin;
  const response = await fetchImpl(`${origin}/.well-known/oauth-authorization-server`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const body = await readJson(response);
  if (!response.ok || !isRecord(body)) {
    throw new CliError("api", `Could not read the OAuth server metadata from ${origin} (HTTP ${response.status}).`, {
      status: response.status,
    });
  }
  // Endpoints must live on the API origin, so a tampered document cannot send the
  // authorization code or tokens anywhere else.
  const endpoint = (key: string): string | undefined => {
    const value = body[key];
    return typeof value === "string" && sameOrigin(value, origin) ? value : undefined;
  };
  const authorizationEndpoint = endpoint("authorization_endpoint");
  const tokenEndpoint = endpoint("token_endpoint");
  const registrationEndpoint = endpoint("registration_endpoint");
  if (!authorizationEndpoint || !tokenEndpoint || !registrationEndpoint) {
    throw new CliError("api", `The OAuth server metadata at ${origin} is missing an endpoint the CLI needs.`);
  }
  const revocationEndpoint = endpoint("revocation_endpoint");
  return {
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    ...(revocationEndpoint ? { revocationEndpoint } : {}),
  };
}

/** Dynamic client registration (RFC 7591) as a public client: no secret, PKCE only. */
export async function registerClient(server: AuthorizationServer, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(server.registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "iZap CLI",
      redirect_uris: [REGISTERED_REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const body = await readJson(response);
  if (response.status === 429) {
    throw new CliError("api", "Too many OAuth client registrations from this network.", {
      status: 429,
      hint: "Wait an hour and retry, or log in with a personal access token: `izap login`.",
    });
  }
  if (!response.ok || !isRecord(body) || typeof body.client_id !== "string") {
    throw new CliError(
      "api",
      `Could not register the CLI with the iZap OAuth server (HTTP ${response.status})${oauthErrorSuffix(body)}.`,
      { status: response.status },
    );
  }
  return body.client_id;
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export interface CallbackListener {
  redirectUri: string;
  /** Resolves with the authorization code from the first request to /callback. */
  code: Promise<string>;
  /** Stops listening. Safe to call more than once. */
  close(): void;
}

/**
 * Listens on 127.0.0.1 at a random port for the OAuth redirect. The first request
 * to /callback settles the login and shuts the server down; so does the timeout.
 */
export async function listenForCallback(state: string, timeoutMs: number): Promise<CallbackListener> {
  const server = createServer();
  let settled = false;
  let closed = false;
  let timer: NodeJS.Timeout | undefined;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // Callers await `code`; this only stops an early close() from being reported as unhandled.
  code.catch(() => undefined);

  const shutdown = () => {
    if (closed) return;
    closed = true;
    server.close();
    server.closeAllConnections();
  };
  const settle = (error: Error | undefined, value?: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) rejectCode(error);
    else resolveCode(value!);
  };

  server.on("request", (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (settled || request.method !== "GET" || url.pathname !== "/callback") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    const outcome = readCallback(url.searchParams, state);
    response.writeHead(outcome.error ? 400 : 200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      connection: "close",
    });
    response.end(callbackPage(!outcome.error), () => shutdown());
    server.close();
    settle(outcome.error, outcome.code);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  timer = setTimeout(() => {
    settle(
      authError(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the browser login.`, RELOGIN_HINT),
    );
    shutdown();
  }, timeoutMs);

  const { port } = server.address() as AddressInfo;
  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    code,
    close() {
      settle(new CliError("cancelled", "Login cancelled."));
      shutdown();
    },
  };
}

/** Opens the URL in the default browser; failures are ignored because the URL is also printed. */
export function openBrowser(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? // Not `cmd /c start`: cmd.exe would treat the `&` in the query string as a separator.
          ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // The URL is printed.
  }
}

function readCallback(params: URLSearchParams, state: string): { code?: string; error?: CliError } {
  if (params.get("state") !== state) {
    return { error: authError("The browser login came back with an unexpected state, so it was rejected.", RELOGIN_HINT) };
  }
  const error = params.get("error");
  if (error) {
    const description = params.get("error_description");
    return {
      error: authError(
        `The browser login failed: ${printable(error)}${description ? ` (${printable(description)})` : ""}.`,
        RELOGIN_HINT,
      ),
    };
  }
  const code = params.get("code");
  if (!code) return { error: authError("The browser login returned no authorization code.", RELOGIN_HINT) };
  return { code };
}

function callbackPage(ok: boolean): string {
  const title = ok ? "You are logged in" : "Login failed";
  const message = ok
    ? "The iZap CLI has your login. You can close this tab and return to the terminal."
    : "Return to the terminal for details.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>iZap CLI</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${message}</p></body></html>`;
}

async function requestTokens(
  fetchImpl: typeof fetch,
  tokenEndpoint: string,
  form: Record<string, string>,
  what: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
  const response = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const body = await readJson(response);
  if (!response.ok || !isRecord(body) || typeof body.access_token !== "string") {
    throw new CliError(
      "auth",
      `The iZap OAuth server refused ${what} (HTTP ${response.status})${oauthErrorSuffix(body)}.`,
      { status: response.status, hint: RELOGIN_HINT },
    );
  }
  return {
    accessToken: body.access_token,
    ...(typeof body.refresh_token === "string" ? { refreshToken: body.refresh_token } : {}),
    ...(typeof body.expires_in === "number" ? { expiresIn: body.expires_in } : {}),
  };
}

// expires_in is only RECOMMENDED (RFC 6749 §5.1); without it, assume an hour so the session still renews.
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

function expiry(expiresIn: number | undefined, now: number): { expiresAt: number } {
  const seconds = expiresIn !== undefined && expiresIn > 0 ? expiresIn : DEFAULT_EXPIRES_IN_SECONDS;
  return { expiresAt: now + seconds * 1000 };
}

function oauthErrorSuffix(body: unknown): string {
  if (!isRecord(body) || typeof body.error !== "string") return "";
  const description = typeof body.error_description === "string" ? ` - ${printable(body.error_description)}` : "";
  return `: ${printable(body.error)}${description}`;
}

function sameOrigin(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function printable(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").slice(0, 200);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
