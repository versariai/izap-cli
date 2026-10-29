import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, vi } from "vitest";

import { runCli } from "../src/cli.js";
import { saveConfig, type Config } from "../src/config.js";
import type { CliDeps } from "../src/deps.js";

export const TOKEN = "izap_pat_cli_test_token_0123456789";
export const ENV_TOKEN = "izap_pat_env_token_9876543210";
export const BUSINESS_ID = "8f0b9e2a-0000-4000-8000-000000000001";
export const CHAT_ID = "b91d4a5e-0000-4000-8000-000000000003";
export const NOW = Date.UTC(2026, 8, 14, 12, 0, 0);
export const POSIX = process.platform !== "win32";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function mockFetch(...responses: Array<Response | Error>) {
  const requests: Request[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function unexpected(name: string): never {
  return (() => {
    throw new Error(`unexpected call to ${name}`);
  }) as never;
}

/** A CLI wired to a temp XDG_CONFIG_HOME, captured output, and no network or TTY. */
export function setup(options: { env?: Record<string, string> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "izap-cli-test-"));
  tempDirs.push(dir);
  const env = { XDG_CONFIG_HOME: dir, ...options.env };
  const configPath = join(dir, "izap", "config.json");

  async function run(argv: string[], deps: Partial<CliDeps> = {}): Promise<RunResult> {
    let stdout = "";
    let stderr = "";
    const code = await runCli(argv, {
      env,
      stdout: { write: (chunk: string) => (stdout += chunk) },
      stderr: { write: (chunk: string) => (stderr += chunk) },
      homedir: () => dir,
      now: () => NOW,
      isInteractive: () => false,
      fetch: unexpected("fetch"),
      promptSecret: unexpected("promptSecret"),
      confirm: unexpected("confirm"),
      readStdin: async () => "",
      openBrowser: unexpected("openBrowser"),
      runProcess: unexpected("runProcess"),
      loginTimeoutMs: 5_000,
      ...deps,
    });
    return { code, stdout, stderr };
  }

  return {
    dir,
    env,
    configPath,
    run,
    readConfig: (): Config => JSON.parse(readFileSync(configPath, "utf8")) as Config,
    writeConfig: (config: Config) => saveConfig(configPath, config),
  };
}
