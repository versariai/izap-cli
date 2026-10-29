import type { Context } from "../context.js";

export interface Command {
  /** The words after `izap`, e.g. "chats list". */
  name: string;
  summary: string;
  help: string;
  /** Command-specific flags; the global ones are always accepted. */
  flags: readonly string[];
  run(ctx: Context, args: readonly string[]): Promise<number | void>;
}
