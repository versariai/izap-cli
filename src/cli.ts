import { assertFlags, parseArgs } from "./args.js";
import { findCommand, globalHelp, helpFor } from "./commands/index.js";
import { runInit } from "./commands/init.js";
import { createContext } from "./context.js";
import { defaultDeps, type CliDeps } from "./deps.js";
import { toCliError } from "./errors.js";
import { Output } from "./output.js";
import { VERSION } from "./version.js";

/** Runs one `izap` invocation and resolves with its exit code. Never throws. */
export async function runCli(argv: readonly string[], overrides: Partial<CliDeps> = {}): Promise<number> {
  const deps: CliDeps = { ...defaultDeps(), ...overrides };
  const out = new Output(deps.stdout, deps.stderr, argv.includes("--json"));
  out.addSecret(deps.env.IZAP_TOKEN?.trim());

  try {
    const wizardArgs = initArguments(argv);
    if (wizardArgs) return await runInit(deps, wizardArgs);

    const { flags, positionals } = parseArgs(argv);
    out.json = flags.json === true;

    if (flags.version === true) {
      if (out.json) out.data({ version: VERSION });
      else out.line(VERSION);
      return 0;
    }
    if (positionals.length === 0 || positionals[0] === "help") {
      const topic = positionals.slice(1);
      out.line(topic.length > 0 ? helpFor(topic) : globalHelp());
      return 0;
    }
    if (flags.help === true) {
      out.line(helpFor(positionals));
      return 0;
    }

    const { command, args } = findCommand(positionals);
    assertFlags(flags, command.flags, command.name);
    const ctx = createContext(deps, flags, out);
    return (await command.run(ctx, args)) ?? 0;
  } catch (error) {
    const failure = toCliError(error);
    out.error(failure);
    return failure.exitCode;
  }
}

// Everything after `init` belongs to the wizard, including flags the CLI would reject.
function initArguments(argv: readonly string[]): string[] | undefined {
  const index = argv.indexOf("init");
  if (index < 0) return undefined;
  try {
    if (parseArgs(argv.slice(0, index)).positionals.length > 0) return undefined;
  } catch {
    return undefined;
  }
  return argv.slice(index + 1);
}
