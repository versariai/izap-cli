import { usageError } from "../errors.js";
import { VERSION } from "../version.js";
import { chatsList, chatsStartTemplate } from "./chats.js";
import {
  contactsCreate,
  contactsImport,
  contactsList,
  contactsShow,
  contactsUpdate,
} from "./contacts.js";
import { INIT_HELP } from "./init.js";
import { stickersDelete, stickersList, stickersUpload } from "./library.js";
import { login, logout } from "./login.js";
import { messagesSend } from "./messages.js";
import { templatesList } from "./templates.js";
import { transmissionsList, transmissionsShow } from "./transmissions.js";
import type { Command } from "./types.js";
import { whoami } from "./whoami.js";

export const COMMANDS: readonly Command[] = [
  login,
  logout,
  whoami,
  chatsList,
  chatsStartTemplate,
  contactsList,
  contactsCreate,
  contactsImport,
  contactsShow,
  contactsUpdate,
  stickersList,
  stickersUpload,
  stickersDelete,
  messagesSend,
  templatesList,
  transmissionsList,
  transmissionsShow,
];

export function findCommand(positionals: readonly string[]): {
  command: Command;
  args: string[];
} {
  const [first = "", second] = positionals;
  const command = [...COMMANDS]
    .sort((a, b) => b.name.split(" ").length - a.name.split(" ").length)
    .find((entry) =>
      entry.name.split(" ").every((word, index) => positionals[index] === word),
    );
  if (command)
    return { command, args: positionals.slice(command.name.split(" ").length) };

  for (let depth = positionals.length; depth >= 1; depth -= 1) {
    const prefix = positionals.slice(0, depth).join(" ");
    const group = subcommandsOf(prefix);
    if (group.length === 0) continue;
    const names = group
      .map((entry) => entry.name.slice(prefix.length + 1))
      .join(", ");
    throw usageError(
      `\`izap ${prefix}\` needs a subcommand: ${names}.`,
      `Run \`izap ${prefix} --help\` for details.`,
    );
  }
  throw usageError(
    `Unknown command: ${first}`,
    "Run `izap --help` to see the commands.",
  );
}

export function helpFor(words: readonly string[]): string {
  const [first = ""] = words;
  const command = COMMANDS.find((entry) => entry.name === words.join(" "));
  if (command) return command.help;
  if (first === "init") return INIT_HELP;
  const group = subcommandsOf(words.join(" "));
  const topGroup = group.length > 0 ? group : subcommandsOf(first);
  if (topGroup.length > 0) {
    const width = Math.max(...topGroup.map((entry) => entry.name.length));
    return [
      `Usage: izap ${words.join(" ") || first} <command> [flags]`,
      "",
      ...topGroup.map(
        (entry) => `  ${entry.name.padEnd(width)}  ${entry.summary}`,
      ),
      "",
      `Run \`izap ${words.join(" ") || first} <command> --help\` for a command's flags.`,
    ].join("\n");
  }
  throw usageError(
    `Unknown command: ${words.join(" ")}`,
    "Run `izap --help` to see the commands.",
  );
}

function subcommandsOf(group: string): Command[] {
  return group
    ? COMMANDS.filter((command) => command.name.startsWith(`${group} `))
    : [];
}

export function globalHelp(): string {
  return `izap ${VERSION}: the iZap command-line tool

Usage
  izap <command> [flags]

Authentication
  login                 Save a personal access token, or log in with --browser
  logout                Remove the saved credential
  whoami                Show who the current credential belongs to

Chats, contacts and messages
  chats list            List conversations
  chats start-template  Start a conversation with a template
  contacts list         List contacts
  contacts create       Create a contact
  contacts import       Import contacts
  contacts show         Show one contact
  contacts update       Update a contact
  messages send         Send a WhatsApp message to a chat (asks you to confirm)

Library
  library stickers list    List library stickers
  library stickers upload  Upload a library sticker
  library stickers delete  Delete a library sticker

Templates and transmissions
  templates list        List WhatsApp message templates
  transmissions list    List bulk transmissions
  transmissions show    Show one transmission

Setup
  init [args...]        Set up an iZap integration with the wizard (npx @izapai/wizard)

Global flags
  --json                Print JSON on stdout (errors go to stderr as JSON)
  --profile <name>      Config profile to use (default: "default", or IZAP_PROFILE)
  --business <id>       Business to act on (default: IZAP_BUSINESS_ID, then the profile's)
  --staging             Use the staging API (https://api-staging.izap.ai)
  --base-url <url>      Use another API origin
  -h, --help            Show help; \`izap <command> --help\` for a command
  -v, --version         Show the version

Environment
  IZAP_TOKEN            Token to use; takes precedence over any saved credential
  IZAP_PROFILE          Default for --profile
  IZAP_BUSINESS_ID      Default for --business
  IZAP_BASE_URL         API origin when neither --staging nor --base-url is given
  XDG_CONFIG_HOME       The config lives in $XDG_CONFIG_HOME/izap/config.json
                        (default ~/.config/izap/config.json)

Exit codes
  0 success, 1 API or network error, 2 usage error, 3 authentication error, 4 cancelled

Docs: https://devs.izap.ai`;
}
