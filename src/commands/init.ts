import type { CliDeps } from "../deps.js";
import { CliError } from "../errors.js";

export const WIZARD_PACKAGE = "@izapai/wizard";

export const INIT_HELP = `Usage: izap init [wizard arguments...]

Runs the iZap setup wizard (npx -y ${WIZARD_PACKAGE}) and passes every argument after
\`init\` to it unchanged, e.g. \`izap init plan\` or \`izap init mcp add --client cursor\`.
For the wizard's own help, run: izap init --help`;

/** `izap init …` → `npx -y @izapai/wizard …`, exiting with the wizard's exit code. */
export async function runInit(deps: CliDeps, args: readonly string[]): Promise<number> {
  try {
    return await deps.runProcess("npx", ["-y", WIZARD_PACKAGE, ...args]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError("api", "Could not run npx, which `izap init` uses to start the setup wizard.", {
        hint: "Install Node.js 20 or later (it includes npx) and try again.",
      });
    }
    throw error;
  }
}
