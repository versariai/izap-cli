import { usageError } from "./errors.js";

export type Flags = Record<string, string | boolean | string[]>;

export interface ParsedArgs {
  flags: Flags;
  positionals: string[];
}

// Every flag the CLI knows. Commands narrow this with assertFlags(); an unknown
// flag is a usage error instead of being silently ignored.
export const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "json",
  "staging",
  "help",
  "version",
  "yes",
  "browser",
]);
export const STRING_FLAGS: ReadonlySet<string> = new Set([
  "profile",
  "business",
  "base-url",
  "token",
  "chat",
  "text",
  "page",
  "page-size",
  "kind",
  "since",
  "status",
  "limit",
  "offset",
  "search",
  "chatbot-id",
  "name",
  "phone",
  "email",
  "tag",
  "tags",
  "notes",
  "title",
  "description",
  "template",
  "template-id",
  "whatsapp-number-id",
  "var",
  "json-rows",
]);
const MULTI_STRING_FLAGS: ReadonlySet<string> = new Set(["tag", "tags", "var"]);
const SHORT_FLAGS: Readonly<Record<string, string>> = { h: "help", v: "version", y: "yes" };

export const GLOBAL_FLAGS: readonly string[] = [
  "json",
  "profile",
  "business",
  "staging",
  "base-url",
  "help",
  "version",
];

const FLAGS_HINT = "Run `izap --help` to see the available flags.";

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: Flags = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const name = token.slice(2, eq >= 0 ? eq : undefined);
      const inline = eq >= 0 ? token.slice(eq + 1) : undefined;

      if (BOOLEAN_FLAGS.has(name)) {
        if (inline !== undefined && inline !== "true" && inline !== "false") {
          throw usageError(`--${name} does not take a value.`);
        }
        flags[name] = inline !== "false";
      } else if (STRING_FLAGS.has(name)) {
        let value = inline;
        if (value === undefined) {
          const next = argv[index + 1];
          if (next === undefined || (next.startsWith("--") && next.length > 2)) {
            throw usageError(
              `--${name} needs a value.`,
              `Use --${name}=<value> for a value that starts with "--".`,
            );
          }
          value = next;
          index += 1;
        }
        if (MULTI_STRING_FLAGS.has(name) && flags[name] !== undefined) {
          const previous = flags[name];
          flags[name] = Array.isArray(previous) ? [...previous, value] : [String(previous), value];
        } else {
          flags[name] = value;
        }
      } else {
        throw usageError(`Unknown flag: --${name}`, FLAGS_HINT);
      }
      continue;
    }

    if (token.length > 1 && token.startsWith("-") && !/^-\d/.test(token)) {
      for (const letter of token.slice(1)) {
        const name = SHORT_FLAGS[letter];
        if (!name) throw usageError(`Unknown flag: -${letter}`, FLAGS_HINT);
        flags[name] = true;
      }
      continue;
    }

    positionals.push(token);
  }

  return { flags, positionals };
}

export function assertFlags(flags: Flags, allowed: readonly string[], command: string): void {
  for (const name of Object.keys(flags)) {
    if (!GLOBAL_FLAGS.includes(name) && !allowed.includes(name)) {
      throw usageError(
        `--${name} is not a flag of \`izap ${command}\`.`,
        `Run \`izap ${command} --help\` to see its flags.`,
      );
    }
  }
}

export function assertNoArgs(args: readonly string[], command: string): void {
  if (args.length > 0) {
    throw usageError(
      `Unexpected argument for \`izap ${command}\`: ${args[0]}`,
      `Run \`izap ${command} --help\` for its usage.`,
    );
  }
}

export function stringFlag(flags: Flags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function stringFlags(flags: Flags, name: string): string[] {
  const value = flags[name];
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}

export function requiredString(flags: Flags, name: string, command: string): string {
  const value = stringFlag(flags, name);
  if (value === undefined || value.trim() === "") {
    throw usageError(`\`izap ${command}\` needs --${name}.`, `Run \`izap ${command} --help\` for its usage.`);
  }
  return value;
}

export function intFlag(
  flags: Flags,
  name: string,
  range: { min: number; max?: number },
): number | undefined {
  const raw = stringFlag(flags, name);
  if (raw === undefined) return undefined;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  const inRange = value >= range.min && (range.max === undefined || value <= range.max);
  if (!Number.isSafeInteger(value) || !inRange) {
    const bounds = range.max === undefined ? `at least ${range.min}` : `from ${range.min} to ${range.max}`;
    throw usageError(`--${name} must be a whole number ${bounds}.`);
  }
  return value;
}
