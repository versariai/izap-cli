import { createHash } from "node:crypto";
import { statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { json, mockFetch, NOW, POSIX, setup } from "./helpers.js";

const ORIGIN = "https://api.izap.ai";
const METADATA = {
  issuer: `${ORIGIN}/oauth`,
  authorization_endpoint: `${ORIGIN}/oauth/authorize`,
  token_endpoint: `${ORIGIN}/oauth/token`,
  registration_endpoint: `${ORIGIN}/oauth/register`,
  revocation_endpoint: `${ORIGIN}/oauth/revoke`,
};
const ACCESS = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.YWNjZXNzLXNpZ25hdHVyZQ";
const REFRESH = "refresh-token-value-0123456789";
const TOKENS = { access_token: ACCESS, token_type: "bearer", expires_in: 28_800, refresh_token: REFRESH };
const PRINCIPAL = { kind: "user", user_id: "u-1", business_id: null, token_id: null };

interface Hit {
  path?: string;
  params: Record<string, string>;
}

/**
 * Stands in for the browser: when the CLI opens the authorize URL, it calls the
 * CLI's real loopback server (127.0.0.1) the way the OAuth redirect would.
 */
function fakeBrowser(callback: (authorizeUrl: URL) => Hit[]) {
  const opened: URL[] = [];
  const statuses: number[] = [];
  let visits: Promise<void> = Promise.resolve();
  const openBrowser = (url: string) => {
    const authorizeUrl = new URL(url);
    opened.push(authorizeUrl);
    const redirect = new URL(authorizeUrl.searchParams.get("redirect_uri")!);
    visits = (async () => {
      for (const hit of callback(authorizeUrl)) {
        const target = new URL(hit.path ?? redirect.pathname, redirect);
        for (const [key, value] of Object.entries(hit.params)) target.searchParams.set(key, value);
        const response = await globalThis.fetch(target);
        statuses.push(response.status);
        await response.text();
      }
    })().catch(() => undefined);
  };
  return {
    opened,
    openBrowser,
    /** HTTP statuses the loopback server answered, once every visit has finished. */
    statuses: async () => {
      await visits;
      return statuses;
    },
  };
}

const loginWith = (code: string) => (url: URL): Hit[] => [
  { params: { code, state: url.searchParams.get("state")! } },
];

describe("izap login --browser", () => {
  it("logs in with authorization code + PKCE on a loopback redirect", async () => {
    const cli = setup();
    const { fetch, requests } = mockFetch(
      json(200, METADATA),
      json(201, { client_id: "dyn_cli", token_endpoint_auth_method: "none" }),
      json(200, TOKENS),
    );
    const browser = fakeBrowser(loginWith("the-code"));
    const result = await cli.run(["login", "--browser"], { fetch, openBrowser: browser.openBrowser });

    expect(result.code).toBe(0);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${ORIGIN}/.well-known/oauth-authorization-server`,
      `POST ${ORIGIN}/oauth/register`,
      `POST ${ORIGIN}/oauth/token`,
    ]);
    expect(await requests[1]!.json()).toMatchObject({
      redirect_uris: ["http://127.0.0.1/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
    });

    const authorize = browser.opened[0]!;
    const redirectUri = authorize.searchParams.get("redirect_uri")!;
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${ORIGIN}/oauth/authorize`);
    expect(authorize.searchParams.get("response_type")).toBe("code");
    expect(authorize.searchParams.get("client_id")).toBe("dyn_cli");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    const form = new URLSearchParams(await requests[2]!.text());
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("the-code");
    expect(form.get("client_id")).toBe("dyn_cli");
    expect(form.get("redirect_uri")).toBe(redirectUri);
    const challenge = createHash("sha256").update(form.get("code_verifier")!).digest("base64url");
    expect(challenge).toBe(authorize.searchParams.get("code_challenge"));

    expect(cli.readConfig().profiles.default).toEqual({
      baseUrl: ORIGIN,
      oauth: {
        clientId: "dyn_cli",
        tokenEndpoint: METADATA.token_endpoint,
        revocationEndpoint: METADATA.revocation_endpoint,
        accessToken: ACCESS,
        refreshToken: REFRESH,
        expiresAt: NOW + 28_800_000,
      },
    });
    if (POSIX) expect(statSync(cli.configPath).mode & 0o777).toBe(0o600);
    expect(result.stdout + result.stderr).not.toContain(ACCESS);
    expect(result.stdout + result.stderr).not.toContain(REFRESH);
    expect(await browser.statuses()).toEqual([200]);

    // One request settles the login; the loopback server is gone afterwards.
    await expect(globalThis.fetch(redirectUri)).rejects.toThrow();
  });

  it("answers other paths with 404 and keeps waiting for /callback", async () => {
    const cli = setup();
    const { fetch } = mockFetch(json(200, METADATA), json(201, { client_id: "dyn_cli" }), json(200, TOKENS));
    const browser = fakeBrowser((url): Hit[] => [
      { path: "/favicon.ico", params: {} },
      { params: { code: "c", state: url.searchParams.get("state")! } },
    ]);
    const result = await cli.run(["login", "--browser"], { fetch, openBrowser: browser.openBrowser });

    expect(result.code).toBe(0);
    expect(await browser.statuses()).toEqual([404, 200]);
  });

  it("reuses the client registered by an earlier browser login", async () => {
    const cli = setup();
    cli.writeConfig({
      profiles: { default: { oauth: { clientId: "dyn_old", tokenEndpoint: METADATA.token_endpoint } } },
    });
    const { fetch, requests } = mockFetch(json(200, METADATA), json(200, TOKENS));
    const browser = fakeBrowser(loginWith("c"));
    const result = await cli.run(["login", "--browser"], { fetch, openBrowser: browser.openBrowser });

    expect(result.code).toBe(0);
    expect(requests).toHaveLength(2);
    expect(browser.opened[0]!.searchParams.get("client_id")).toBe("dyn_old");
  });

  it("rejects a callback with the wrong state and never exchanges a code", async () => {
    const cli = setup();
    const { fetch, requests } = mockFetch(json(200, METADATA), json(201, { client_id: "dyn_cli" }));
    const browser = fakeBrowser(() => [{ params: { code: "stolen", state: "forged" } }]);
    const result = await cli.run(["login", "--browser"], { fetch, openBrowser: browser.openBrowser });

    expect(result.code).toBe(3);
    expect(result.stderr).toContain("unexpected state");
    expect(requests).toHaveLength(2);
    expect(await browser.statuses()).toEqual([400]);
    expect(cli.readConfig).toThrow();
  });

  it("reports an authorization error from the server", async () => {
    const cli = setup();
    const { fetch } = mockFetch(json(200, METADATA), json(201, { client_id: "dyn_cli" }));
    const browser = fakeBrowser((url) => [
      { params: { error: "access_denied", state: url.searchParams.get("state")! } },
    ]);
    const result = await cli.run(["login", "--browser"], { fetch, openBrowser: browser.openBrowser });

    expect(result.code).toBe(3);
    expect(result.stderr).toContain("The browser login failed: access_denied");
  });

  it("times out and closes the loopback server", async () => {
    const cli = setup();
    const { fetch } = mockFetch(json(200, METADATA), json(201, { client_id: "dyn_cli" }));
    let redirectUri = "";
    const result = await cli.run(["login", "--browser"], {
      fetch,
      loginTimeoutMs: 50,
      openBrowser: (url) => {
        redirectUri = new URL(url).searchParams.get("redirect_uri")!;
      },
    });

    expect(result.code).toBe(3);
    expect(result.stderr).toContain("Timed out");
    await expect(globalThis.fetch(redirectUri)).rejects.toThrow();
  });

  it("refuses metadata that points the token endpoint at another origin", async () => {
    const cli = setup();
    const { fetch, requests } = mockFetch(
      json(200, { ...METADATA, token_endpoint: "https://evil.example.com/token" }),
    );
    const result = await cli.run(["login", "--browser"], { fetch });

    expect(result.code).toBe(1);
    expect(requests).toHaveLength(1);
  });
});

describe("browser sessions", () => {
  const expired = {
    clientId: "dyn_cli",
    tokenEndpoint: METADATA.token_endpoint,
    revocationEndpoint: METADATA.revocation_endpoint,
    accessToken: "old-access-token-value",
    refreshToken: "old-refresh-token-value",
    expiresAt: NOW - 1,
  };

  it("refreshes an expired access token before the request and saves the new pair", async () => {
    const cli = setup();
    cli.writeConfig({ profiles: { default: { baseUrl: ORIGIN, oauth: expired } } });
    const { fetch, requests } = mockFetch(
      json(200, { access_token: ACCESS, refresh_token: "rotated-refresh-token", expires_in: 3600 }),
      json(200, PRINCIPAL),
    );
    const result = await cli.run(["whoami"], { fetch });

    expect(result.code).toBe(0);
    const form = new URLSearchParams(await requests[0]!.text());
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "old-refresh-token-value",
      client_id: "dyn_cli",
    });
    expect(requests[1]!.headers.get("authorization")).toBe(`Bearer ${ACCESS}`);
    expect(result.stdout).toContain("browser login");
    expect(cli.readConfig().profiles.default?.oauth).toMatchObject({
      accessToken: ACCESS,
      refreshToken: "rotated-refresh-token",
      expiresAt: NOW + 3_600_000,
    });
  });

  it("renews a session with no known expiry, and assumes an hour when expires_in is absent", async () => {
    const cli = setup();
    const { expiresAt: _expiresAt, ...unknownExpiry } = expired;
    cli.writeConfig({ profiles: { default: { baseUrl: ORIGIN, oauth: unknownExpiry } } });
    const { fetch, requests } = mockFetch(
      json(200, { access_token: ACCESS, refresh_token: "rotated-refresh-token" }),
      json(200, PRINCIPAL),
    );
    const result = await cli.run(["whoami"], { fetch });

    expect(result.code).toBe(0);
    expect(new URLSearchParams(await requests[0]!.text()).get("grant_type")).toBe("refresh_token");
    expect(cli.readConfig().profiles.default?.oauth?.expiresAt).toBe(NOW + 3_600_000);
  });

  it("exits 3 when the refresh is refused", async () => {
    const cli = setup();
    cli.writeConfig({ profiles: { default: { baseUrl: ORIGIN, oauth: expired } } });
    const { fetch } = mockFetch(json(400, { error: "invalid_grant" }));
    const result = await cli.run(["whoami"], { fetch });

    expect(result.code).toBe(3);
    expect(result.stderr).toContain("invalid_grant");
    expect(result.stderr).toContain("izap login --browser");
  });

  it("logout revokes the session and keeps only the client registration", async () => {
    const cli = setup();
    cli.writeConfig({ profiles: { default: { baseUrl: ORIGIN, oauth: expired } } });
    const { fetch, requests } = mockFetch(new Response(null, { status: 200 }), new Response(null, { status: 200 }));
    const result = await cli.run(["logout"], { fetch });

    expect(result.code).toBe(0);
    expect(requests.map((request) => request.url)).toEqual([METADATA.revocation_endpoint, METADATA.revocation_endpoint]);
    expect(new URLSearchParams(await requests[0]!.text()).get("token")).toBe("old-refresh-token-value");
    expect(cli.readConfig().profiles.default).toEqual({
      baseUrl: ORIGIN,
      oauth: {
        clientId: "dyn_cli",
        tokenEndpoint: METADATA.token_endpoint,
        revocationEndpoint: METADATA.revocation_endpoint,
      },
    });
  });
});
