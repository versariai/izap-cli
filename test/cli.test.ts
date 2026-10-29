import { statSync } from "node:fs";
import { dirname } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { STAGING_BASE_URL } from "../src/config.js";
import {
  BUSINESS_ID,
  CHAT_ID,
  ENV_TOKEN,
  json,
  mockFetch,
  POSIX,
  setup,
  TOKEN,
} from "./helpers.js";

const API = "https://api.izap.ai/api/v1";
const PRINCIPAL = {
  kind: "user",
  user_id: "u-1",
  business_id: null,
  token_id: "tok-1",
};
const CHATS = {
  chats: [
    {
      id: CHAT_ID,
      business_id: BUSINESS_ID,
      session_id: "s-1",
      timestamp: "2026-09-14T11:30:00+00:00",
      created: "2026-09-01T10:00:00+00:00",
      messages: [],
      kind: "real",
      consumer: {
        id: "c-1",
        nickname: "Maria",
        phone_number: "+5511999990000",
      },
      last_message: { status: "read", content: "Obrigada!" },
    },
  ],
  pagination: {
    page: 2,
    page_size: 5,
    total_count: 7,
    total_pages: 2,
    has_next: false,
    has_previous: true,
  },
};
const TEMPLATES = {
  templates: [
    {
      id: "tpl-1",
      business_id: BUSINESS_ID,
      name: "order_shipped",
      language: "pt_BR",
      category: "UTILITY",
      status: "approved",
      body_text: "Seu pedido saiu",
      created: "2026-09-01T10:00:00Z",
      modified: "2026-09-01T10:00:00Z",
    },
  ],
  total_count: 1,
};
const TRANSMISSION = {
  transmission_id: "tr-1",
  name: "September promo",
  status: "completed",
  transmission_type: "template",
  template_name: "promo",
  total_recipients: 10,
  sent_count: 9,
  failed_count: 1,
  pending_count: 0,
  progress_pct: 100,
  scheduled_at: null,
  started_at: "2026-09-10T12:00:00Z",
  completed_at: "2026-09-10T12:05:00Z",
  created: "2026-09-10T11:59:00Z",
  business_id: BUSINESS_ID,
};
const SENT = {
  user_message: {
    id: "m-1",
    content: "Olá!",
    no_reply: true,
    timestamp: "2026-09-14T12:00:00Z",
    status: "sent",
    error_code: null,
    error_reason: null,
    sender_user_id: "u-1",
  },
};
const CONTACT = {
  id: "c-1",
  name: "Ana",
  phone_number: "+5511999990000",
  email: "ana@example.com",
  tags: ["vip"],
  notes: "Prefers WhatsApp",
  created_at: "2026-09-14T12:00:00Z",
  last_interaction_at: "2026-09-14T12:30:00Z",
  conversation_id: CHAT_ID,
  ai_paused: false,
  opted_out: false,
};

/** A CLI with a saved token and default business. */
function loggedIn(options: { env?: Record<string, string> } = {}) {
  const cli = setup(options);
  cli.writeConfig({
    profiles: { default: { token: TOKEN, businessId: BUSINESS_ID } },
  });
  return cli;
}

describe("login", () => {
  it("saves a token to a 0600 file under XDG_CONFIG_HOME without printing it", async () => {
    const cli = setup();
    const result = await cli.run([
      "login",
      "--token",
      TOKEN,
      "--profile",
      "test",
    ]);

    expect(result.code).toBe(0);
    expect(cli.configPath.startsWith(cli.dir)).toBe(true);
    expect(cli.readConfig()).toEqual({
      profiles: { test: { baseUrl: "https://api.izap.ai", token: TOKEN } },
    });
    if (POSIX) {
      expect(statSync(cli.configPath).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(cli.configPath)).mode & 0o777).toBe(0o700);
    }
    expect(result.stdout).toContain('profile "test"');
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
  });

  it("saves the staging API and a default business for the profile", async () => {
    const cli = setup();
    await cli.run([
      "login",
      "--token",
      TOKEN,
      "--staging",
      "--business",
      BUSINESS_ID,
    ]);

    expect(cli.readConfig().profiles.default).toEqual({
      baseUrl: STAGING_BASE_URL,
      businessId: BUSINESS_ID,
      token: TOKEN,
    });
  });

  it("takes the token from IZAP_TOKEN, then stdin", async () => {
    const fromEnv = setup({ env: { IZAP_TOKEN: ENV_TOKEN } });
    expect((await fromEnv.run(["login"])).code).toBe(0);
    expect(fromEnv.readConfig().profiles.default?.token).toBe(ENV_TOKEN);

    const fromStdin = setup();
    expect(
      (await fromStdin.run(["login"], { readStdin: async () => `${TOKEN}\n` }))
        .code,
    ).toBe(0);
    expect(fromStdin.readConfig().profiles.default?.token).toBe(TOKEN);
  });

  it("prompts for the token without echo when interactive", async () => {
    const cli = setup();
    const promptSecret = vi.fn(async () => TOKEN);
    const result = await cli.run(["login"], {
      isInteractive: () => true,
      promptSecret,
    });

    expect(result.code).toBe(0);
    expect(promptSecret).toHaveBeenCalledOnce();
    expect(cli.readConfig().profiles.default?.token).toBe(TOKEN);
  });

  it("rejects an empty token or one with spaces", async () => {
    const cli = setup();
    expect((await cli.run(["login"])).code).toBe(2);
    expect((await cli.run(["login", "--token", `Bearer ${TOKEN}`])).code).toBe(
      2,
    );
  });

  it("warns about, but saves, a token without an izap_ prefix", async () => {
    const cli = setup();
    const result = await cli.run(["login", "--token", "fake-token"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("does not look like an iZap token");
    expect(cli.readConfig().profiles.default?.token).toBe("fake-token");
  });

  it("prints the saved profile as JSON, without the token", async () => {
    const cli = setup();
    const result = await cli.run(["login", "--token", TOKEN, "--json"]);

    expect(JSON.parse(result.stdout)).toEqual({
      profile: "default",
      baseUrl: "https://api.izap.ai",
      businessId: null,
      credential: "token",
      configPath: cli.configPath,
    });
    expect(result.stdout).not.toContain(TOKEN);
  });

  it("notes that IZAP_TOKEN takes precedence over a different saved token", async () => {
    const cli = setup({ env: { IZAP_TOKEN: ENV_TOKEN } });
    const result = await cli.run(["login", "--token", TOKEN]);
    expect(result.stderr).toContain("IZAP_TOKEN is set");
  });
});

describe("logout", () => {
  it("removes the token and keeps the rest of the profile", async () => {
    const cli = loggedIn();
    const result = await cli.run(["logout"]);

    expect(result.code).toBe(0);
    expect(cli.readConfig().profiles.default).toEqual({
      businessId: BUSINESS_ID,
    });
    expect(result.stdout).toContain("removed the saved credential");
  });

  it("says so when nothing is saved, and warns that IZAP_TOKEN still applies", async () => {
    const cli = setup({ env: { IZAP_TOKEN: ENV_TOKEN } });
    const result = await cli.run(["logout", "--json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      profile: "default",
      removed: false,
    });
    expect(result.stderr).toContain("IZAP_TOKEN is still set");
  });
});

describe("whoami", () => {
  it("introspects the saved token and never prints it", async () => {
    const cli = loggedIn();
    const { fetch, requests } = mockFetch(json(200, PRINCIPAL));
    const result = await cli.run(["whoami"], { fetch });

    expect(result.code).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.url).toBe(`${API}/auth/token/introspect`);
    expect(requests[0]!.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(requests[0]!.headers.get("user-agent")).toMatch(
      /^izap-cli\/0\.1\.0 izap-sdk-typescript\//,
    );
    expect(result.stdout).toContain("u-1");
    expect(result.stdout).toContain("saved token");
    expect(result.stdout).toContain(BUSINESS_ID);
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
  });

  it("uses IZAP_TOKEN over the saved token", async () => {
    const cli = loggedIn({ env: { IZAP_TOKEN: ENV_TOKEN } });
    const { fetch, requests } = mockFetch(json(200, PRINCIPAL));
    const result = await cli.run(["whoami", "--json"], { fetch });

    expect(requests[0]!.headers.get("authorization")).toBe(
      `Bearer ${ENV_TOKEN}`,
    );
    expect(JSON.parse(result.stdout)).toEqual({
      profile: "default",
      baseUrl: "https://api.izap.ai",
      credential: "env",
      businessId: BUSINESS_ID,
      principal: PRINCIPAL,
    });
  });

  it("exits 3 without a request when not logged in", async () => {
    const cli = setup();
    const result = await cli.run(["whoami"]);

    expect(result.code).toBe(3);
    expect(result.stderr).toContain("Not logged in");
  });

  it("maps a 401 to exit 3 and redacts a token echoed back in the error", async () => {
    const cli = loggedIn();
    const { fetch } = mockFetch(
      json(401, { detail: `Invalid token ${TOKEN}` }),
    );
    const result = await cli.run(["whoami"], { fetch });

    expect(result.code).toBe(3);
    expect(result.stderr).toContain("iZap API error 401");
    expect(result.stderr).toContain("[REDACTED]");
    expect(result.stderr).not.toContain(TOKEN);
  });

  it("writes --json errors to stderr as JSON", async () => {
    const cli = loggedIn();
    const { fetch } = mockFetch(json(401, { detail: "Not authenticated" }));
    const result = await cli.run(["whoami", "--json"], { fetch });

    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        type: "auth",
        message: "iZap API error 401: Not authenticated",
        status: 401,
        code: null,
        hint: "Run `izap login` (or set IZAP_TOKEN) and try again.",
      },
    });
  });
});

describe("chats list", () => {
  it("lists real chats for the profile's business", async () => {
    const cli = loggedIn();
    const { fetch, requests } = mockFetch(json(200, CHATS));
    const result = await cli.run(
      ["chats", "list", "--page", "2", "--page-size", "5"],
      { fetch },
    );

    expect(result.code).toBe(0);
    expect(requests[0]!.url).toBe(`${API}/chats?kind=real&page=2&page_size=5`);
    expect(requests[0]!.headers.get("business-id")).toBe(BUSINESS_ID);
    expect(result.stdout).toMatch(
      /^ID\s+CONTACT\s+LAST ACTIVITY\s+LAST MESSAGE$/m,
    );
    expect(result.stdout).toContain("Maria");
    expect(result.stdout).toContain("2026-09-14 11:30 UTC");
    expect(result.stdout).toContain("Page 2 of 2 (7 chats)");
  });

  it("uses --business, --kind and --staging when given", async () => {
    const cli = loggedIn();
    const other = "11111111-0000-4000-8000-000000000000";
    const { fetch, requests } = mockFetch(json(200, { ...CHATS, chats: [] }));
    const result = await cli.run(
      ["chats", "list", "--business", other, "--kind", "all", "--staging"],
      { fetch },
    );

    expect(result.stdout).toContain("No chats found.");
    expect(requests[0]!.url).toBe(`${STAGING_BASE_URL}/api/v1/chats?kind=all`);
    expect(requests[0]!.headers.get("business-id")).toBe(other);
  });

  it("prints the API response as JSON", async () => {
    const cli = loggedIn();
    const { fetch } = mockFetch(json(200, CHATS));
    const result = await cli.run(["chats", "list", "--json"], { fetch });
    expect(JSON.parse(result.stdout)).toEqual(CHATS);
  });

  it("needs a business, and valid flag values, before any request", async () => {
    const cli = setup();
    cli.writeConfig({ profiles: { default: { token: TOKEN } } });

    const noBusiness = await cli.run(["chats", "list"]);
    expect(noBusiness.code).toBe(2);
    expect(noBusiness.stderr).toContain("No business selected.");
    expect(
      (
        await cli.run([
          "chats",
          "list",
          "--business",
          BUSINESS_ID,
          "--kind",
          "x",
        ])
      ).code,
    ).toBe(2);
    expect(
      (
        await cli.run([
          "chats",
          "list",
          "--business",
          BUSINESS_ID,
          "--page-size",
          "500",
        ])
      ).code,
    ).toBe(2);
  });
});

describe("messages send", () => {
  const send = ["messages", "send", "--chat", CHAT_ID, "--text", "Olá!"];

  it("refuses to send without --yes when stdin is not a terminal", async () => {
    const cli = loggedIn();
    const { fetch, requests } = mockFetch();
    const result = await cli.run(send, { fetch });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Refusing to send without confirmation");
    expect(requests).toHaveLength(0);
  });

  it("sends nothing when the user declines", async () => {
    const cli = loggedIn();
    const { fetch, requests } = mockFetch();
    const confirm = vi.fn(async () => false);
    const result = await cli.run(send, {
      fetch,
      isInteractive: () => true,
      confirm,
    });

    expect(result.code).toBe(4);
    expect(confirm).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(0);
  });

  it("sends after the user confirms", async () => {
    const cli = loggedIn();
    const { fetch, requests } = mockFetch(json(200, SENT));
    const confirm = vi.fn(async (_question: string) => true);
    const result = await cli.run(send, {
      fetch,
      isInteractive: () => true,
      confirm,
    });

    expect(result.code).toBe(0);
    expect(confirm.mock.calls[0]![0]).toContain("Olá!");
    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.url).toBe(`${API}/chats/${CHAT_ID}/messages`);
    expect(await requests[0]!.json()).toEqual({ content: "Olá!" });
    expect(result.stdout).toContain("Sent message m-1");
  });

  it("sends with --yes without asking, and prints JSON", async () => {
    const cli = loggedIn();
    const { fetch, requests } = mockFetch(json(200, SENT));
    const result = await cli.run([...send, "--yes", "--json"], { fetch });

    expect(result.code).toBe(0);
    expect(requests).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual(SENT);
  });

  it("needs --chat and --text", async () => {
    const cli = loggedIn();
    expect(
      (await cli.run(["messages", "send", "--text", "hi", "--yes"])).code,
    ).toBe(2);
    expect(
      (await cli.run(["messages", "send", "--chat", CHAT_ID, "--yes"])).code,
    ).toBe(2);
  });
});

describe("contacts", () => {
  it("lists contacts for the profile's business", async () => {
    const cli = loggedIn();
    const { fetch, requests } = mockFetch(
      json(200, { items: [CONTACT], total: 1, page: 1, page_size: 20 }),
    );
    const result = await cli.run(
      ["contacts", "list", "--search", "Ana", "--page-size", "20"],
      { fetch },
    );

    expect(result.code).toBe(0);
    expect(requests[0]!.url).toBe(`${API}/contacts?search=Ana&page_size=20`);
    expect(requests[0]!.headers.get("business-id")).toBe(BUSINESS_ID);
    expect(result.stdout).toContain("Ana");
    expect(result.stdout).toContain("+5511999990000");
    expect(result.stdout).toContain("1 contact");
  });

  it("creates and updates contacts", async () => {
    const cli = loggedIn();
    const { fetch, requests } = mockFetch(
      json(201, CONTACT),
      json(200, { ...CONTACT, notes: "Updated" }),
    );

    const created = await cli.run(
      [
        "contacts",
        "create",
        "--name",
        "Ana",
        "--phone",
        "+5511999990000",
        "--email",
        "ana@example.com",
        "--tag",
        "vip",
      ],
      { fetch },
    );
    const updated = await cli.run(
      ["contacts", "update", "c-1", "--notes", "Updated"],
      { fetch },
    );

    expect(created.code).toBe(0);
    expect(updated.code).toBe(0);
    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.url).toBe(`${API}/contacts`);
    expect(await requests[0]!.json()).toEqual({
      name: "Ana",
      phone_number: "+5511999990000",
      email: "ana@example.com",
      tags: ["vip"],
    });
    expect(requests[1]!.method).toBe("PATCH");
    expect(requests[1]!.url).toBe(`${API}/contacts/c-1`);
    expect(await requests[1]!.json()).toEqual({ notes: "Updated" });
  });

  it("imports contacts from JSON and shows one contact", async () => {
    const cli = loggedIn();
    const { fetch, requests } = mockFetch(
      json(200, { created: 1, updated: 0, skipped: [] }),
      json(200, { ...CONTACT, conversations: [] }),
    );

    const imported = await cli.run(
      [
        "contacts",
        "import",
        "--json-rows",
        JSON.stringify([
          { phone: "+5511999990000", name: "Ana", tags: "vip, lead" },
        ]),
      ],
      { fetch },
    );
    const shown = await cli.run(["contacts", "show", "c-1"], { fetch });

    expect(imported.code).toBe(0);
    expect(shown.code).toBe(0);
    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.url).toBe(`${API}/contacts/import`);
    expect(await requests[0]!.json()).toEqual({
      rows: [
        { phone_number: "+5511999990000", name: "Ana", tags: ["vip", "lead"] },
      ],
    });
    expect(requests[1]!.url).toBe(`${API}/contacts/c-1`);
    expect(shown.stdout).toContain("Prefers WhatsApp");
  });
});

describe("library stickers", () => {
  it("lists and deletes stickers", async () => {
    const cli = loggedIn();
    const sticker = {
      ...CONTACT,
      id: "sticker-1",
      title: "Thanks",
      url: "https://cdn.example/sticker.webp",
    };
    const { fetch, requests } = mockFetch(
      json(200, {
        stickers: [sticker],
        total: 1,
        limit: 20,
        offset: 0,
        has_next: false,
      }),
      new Response(null, { status: 204 }),
    );

    const listed = await cli.run(["library", "stickers", "list"], { fetch });
    const deleted = await cli.run(
      ["library", "stickers", "delete", "sticker-1"],
      { fetch },
    );

    expect(listed.code).toBe(0);
    expect(deleted.code).toBe(0);
    expect(requests[0]!.url).toBe(`${API}/businesses/library/stickers`);
    expect(requests[1]!.method).toBe("DELETE");
    expect(requests[1]!.url).toBe(
      `${API}/businesses/library/stickers/sticker-1`,
    );
    expect(listed.stdout).toContain("Thanks");
  });
});

describe("template conversations", () => {
  it("starts a template conversation", async () => {
    const cli = loggedIn();
    const { fetch, requests } = mockFetch(
      json(201, {
        chat_id: CHAT_ID,
        consumer_id: "c-1",
        user_message: SENT.user_message,
      }),
    );
    const result = await cli.run(
      [
        "chats",
        "start-template",
        "--template",
        "tpl-1",
        "--phone",
        "+5511999990000",
        "--name",
        "Ana",
        "--var",
        "1=Ana",
      ],
      { fetch },
    );

    expect(result.code).toBe(0);
    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.url).toBe(`${API}/chats/template-conversations`);
    expect(await requests[0]!.json()).toEqual({
      template_id: "tpl-1",
      phone: "+5511999990000",
      name: "Ana",
      variables: { "1": "Ana" },
    });
    expect(result.stdout).toContain(CHAT_ID);
  });
});

describe("templates list", () => {
  it("maps --status to the query and prints a table", async () => {
    const cli = loggedIn();
    const { fetch, requests } = mockFetch(json(200, TEMPLATES));
    const result = await cli.run(
      ["templates", "list", "--status", "approved"],
      { fetch },
    );

    expect(result.code).toBe(0);
    expect(requests[0]!.url).toBe(`${API}/whatsapp_templates?status=approved`);
    expect(requests[0]!.headers.get("business-id")).toBe(BUSINESS_ID);
    expect(result.stdout).toContain("order_shipped");
    expect(result.stdout).toContain("1 template");
  });

  it("rejects an unknown status", async () => {
    const cli = loggedIn();
    expect(
      (await cli.run(["templates", "list", "--status", "live"])).code,
    ).toBe(2);
  });
});

describe("transmissions", () => {
  it("lists with --status and --limit", async () => {
    const cli = loggedIn();
    const { fetch, requests } = mockFetch(
      json(200, {
        transmissions: [TRANSMISSION],
        total: 3,
        business_id: BUSINESS_ID,
      }),
    );
    const result = await cli.run(
      ["transmissions", "list", "--status", "completed", "--limit", "1"],
      { fetch },
    );

    expect(result.code).toBe(0);
    expect(requests[0]!.url).toBe(
      `${API}/transmissions?status=completed&limit=1`,
    );
    expect(result.stdout).toContain("September promo");
    expect(result.stdout).toContain("Showing 1 of 3.");
  });

  it("shows one transmission", async () => {
    const cli = loggedIn();
    const { fetch, requests } = mockFetch(json(200, TRANSMISSION));
    const result = await cli.run(["transmissions", "show", "tr-1"], { fetch });

    expect(result.code).toBe(0);
    expect(requests[0]!.url).toBe(`${API}/transmissions/tr-1`);
    expect(result.stdout).toMatch(/^Progress\s+100%$/m);
  });

  it("needs an id for show", async () => {
    const cli = loggedIn();
    expect((await cli.run(["transmissions", "show"])).code).toBe(2);
  });
});

describe("errors and exit codes", () => {
  it("exits 1 on an API error", async () => {
    const cli = loggedIn();
    const { fetch } = mockFetch(
      json(404, { detail: "Transmission not found" }),
    );
    const result = await cli.run(["transmissions", "show", "nope"], { fetch });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "iZap API error 404: Transmission not found",
    );
  });

  it("adds a hint when the plan lacks the REST API", async () => {
    const cli = loggedIn();
    const { fetch } = mockFetch(
      json(403, {
        detail: {
          code: "plan_limit_rest_api",
          message: "REST API not in plan",
        },
      }),
    );
    const result = await cli.run(["templates", "list"], { fetch });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("does not include the REST API");
  });

  it("exits 1 when the API cannot be reached", async () => {
    const cli = loggedIn();
    const failure = new TypeError("fetch failed", {
      cause: { code: "ENOTFOUND" },
    });
    const { fetch } = mockFetch(failure, failure, failure);
    const result = await cli.run(["templates", "list"], { fetch });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Could not reach the iZap API (ENOTFOUND)");
  });

  it("exits 2 on unknown commands and flags", async () => {
    const cli = setup();
    expect((await cli.run(["nope"])).code).toBe(2);
    expect((await cli.run(["chats"])).code).toBe(2);
    const incompleteNested = await cli.run(["library", "stickers"]);
    expect(incompleteNested.code).toBe(2);
    expect(incompleteNested.stderr).toContain(
      "`izap library stickers` needs a subcommand",
    );
    expect((await cli.run(["chats", "list", "--yes"])).code).toBe(2);
    expect((await cli.run(["whoami", "--bogus"])).code).toBe(2);
  });
});

describe("init", () => {
  it("runs the wizard through npx and passes every argument through", async () => {
    const cli = setup();
    const runProcess = vi.fn(async () => 7);
    const result = await cli.run(
      ["--staging", "init", "mcp", "add", "--client", "cursor", "--json"],
      {
        runProcess,
      },
    );

    expect(result.code).toBe(7);
    expect(runProcess).toHaveBeenCalledWith("npx", [
      "-y",
      "@izapai/wizard",
      "mcp",
      "add",
      "--client",
      "cursor",
      "--json",
    ]);
  });

  it("exits 1 with a hint when npx is missing", async () => {
    const cli = setup();
    const missing = Object.assign(new Error("spawn npx ENOENT"), {
      code: "ENOENT",
    });
    const result = await cli.run(["init"], {
      runProcess: async () => Promise.reject(missing),
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Could not run npx");
  });
});

describe("help and version", () => {
  it("prints the global help", async () => {
    const cli = setup();
    for (const argv of [[], ["--help"], ["help"]]) {
      const result = await cli.run(argv);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("izap <command> [flags]");
    }
  });

  it("prints command and group help", async () => {
    const cli = setup();
    expect((await cli.run(["messages", "send", "--help"])).stdout).toContain(
      "--yes",
    );
    expect((await cli.run(["help", "chats", "list"])).stdout).toContain(
      "--page-size",
    );
    expect((await cli.run(["transmissions", "--help"])).stdout).toContain(
      "transmissions show",
    );
  });

  it("prints the version", async () => {
    const cli = setup();
    expect((await cli.run(["--version"])).stdout).toBe("0.1.0\n");
    expect(JSON.parse((await cli.run(["-v", "--json"])).stdout)).toEqual({
      version: "0.1.0",
    });
  });
});
