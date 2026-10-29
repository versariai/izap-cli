import type { CliError } from "./errors.js";
import { redact } from "./redact.js";

export interface Writer {
  write(chunk: string): unknown;
}

/**
 * Everything the CLI prints goes through here, so every line is redacted:
 * results on stdout, notes and errors on stderr.
 */
export class Output {
  json: boolean;
  private readonly secrets: string[] = [];

  constructor(
    private readonly stdout: Writer,
    private readonly stderr: Writer,
    json: boolean,
  ) {
    this.json = json;
  }

  addSecret(value: string | undefined): void {
    if (value && !this.secrets.includes(value)) this.secrets.push(value);
  }

  /** `--json` result: the value as indented JSON on stdout. */
  data(value: unknown): void {
    this.stdout.write(`${this.clean(JSON.stringify(value, null, 2))}\n`);
  }

  line(text = ""): void {
    this.stdout.write(`${this.clean(text)}\n`);
  }

  /** Progress, warnings and hints: stderr, so stdout stays pipeable. */
  note(text: string): void {
    this.stderr.write(`${this.clean(text)}\n`);
  }

  error(error: CliError): void {
    if (this.json) {
      const body = {
        error: {
          type: error.kind,
          message: error.message,
          status: error.status ?? null,
          code: error.code ?? null,
          hint: error.hint ?? null,
        },
      };
      this.stderr.write(`${this.clean(JSON.stringify(body))}\n`);
      return;
    }
    this.stderr.write(`${this.clean(`Error: ${error.message}`)}\n`);
    if (error.hint) this.stderr.write(`${this.clean(error.hint)}\n`);
  }

  private clean(text: string): string {
    return redact(text, this.secrets);
  }
}
