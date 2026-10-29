import { homedir } from "node:os";

import { LOGIN_TIMEOUT_MS, openBrowser } from "./oauth.js";
import type { Writer } from "./output.js";
import { runProcess } from "./process.js";
import { confirm, promptSecret, readStdin } from "./prompt.js";

/** Everything the CLI touches outside its own code, so tests can replace it. */
export interface CliDeps {
  env: Readonly<Record<string, string | undefined>>;
  stdout: Writer;
  stderr: Writer;
  fetch: typeof fetch;
  homedir: () => string;
  now: () => number;
  /** True when a person can answer prompts on stdin. */
  isInteractive: () => boolean;
  promptSecret: (question: string) => Promise<string>;
  confirm: (question: string) => Promise<boolean>;
  readStdin: () => Promise<string>;
  openBrowser: (url: string) => void;
  runProcess: (command: string, args: readonly string[]) => Promise<number>;
  loginTimeoutMs: number;
}

export function defaultDeps(): CliDeps {
  return {
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    fetch: (input, init) => globalThis.fetch(input, init),
    homedir,
    now: Date.now,
    isInteractive: () => Boolean(process.stdin.isTTY),
    promptSecret: (question) => promptSecret(question, process.stdin, process.stderr),
    confirm: (question) => confirm(question, process.stdin, process.stderr),
    readStdin: () => readStdin(process.stdin),
    openBrowser,
    runProcess,
    loginTimeoutMs: LOGIN_TIMEOUT_MS,
  };
}
