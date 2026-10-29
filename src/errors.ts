import { IzapApiError } from "@izapai/sdk";

/** Process exit codes, documented in the README and `izap --help`. */
export const EXIT = {
  ok: 0,
  api: 1,
  usage: 2,
  auth: 3,
  cancelled: 4,
} as const;

export type ErrorKind = "api" | "usage" | "auth" | "cancelled";

export interface CliErrorDetails {
  status?: number;
  code?: string;
  hint?: string;
}

/** An error reported to the user; `kind` picks the exit code. */
export class CliError extends Error {
  override readonly name = "CliError";
  readonly kind: ErrorKind;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly hint: string | undefined;

  constructor(kind: ErrorKind, message: string, details: CliErrorDetails = {}) {
    super(message);
    this.kind = kind;
    this.status = details.status;
    this.code = details.code;
    this.hint = details.hint;
  }

  get exitCode(): number {
    return EXIT[this.kind];
  }
}

export function usageError(message: string, hint?: string): CliError {
  return new CliError("usage", message, { hint });
}

export function authError(message: string, hint?: string): CliError {
  return new CliError("auth", message, { hint });
}

export const LOGIN_HINT = "Run `izap login` (or set IZAP_TOKEN) and try again.";

const PLAN_HINTS: Record<string, string> = {
  plan_limit_rest_api:
    "Your iZap plan does not include the REST API. Upgrade in the dashboard to use API keys.",
};

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;

  if (error instanceof IzapApiError) {
    const details = { status: error.status, code: error.code };
    if (error.status === 401) {
      return new CliError("auth", error.message, { ...details, hint: LOGIN_HINT });
    }
    const hint = error.code ? PLAN_HINTS[error.code] : undefined;
    return new CliError("api", error.message, { ...details, hint });
  }

  if (error instanceof Error && error.name === "TimeoutError") {
    return new CliError("api", "The iZap API did not respond in time.", {
      hint: "Check your connection and try again.",
    });
  }

  // Node's fetch reports DNS, TLS and connection failures as `TypeError: fetch failed`.
  if (error instanceof TypeError && error.message === "fetch failed") {
    const cause = (error as { cause?: { code?: unknown; message?: unknown } }).cause;
    const reason = typeof cause?.code === "string" ? cause.code : cause?.message;
    return new CliError(
      "api",
      `Could not reach the iZap API${typeof reason === "string" ? ` (${reason})` : ""}.`,
      { hint: "Check your connection, or the --base-url / --staging you passed." },
    );
  }

  return new CliError("api", error instanceof Error ? error.message : String(error));
}
