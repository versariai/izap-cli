import { assertNoArgs, intFlag, requiredString, stringFlag, stringFlags } from "../args.js";
import { apiClient } from "../auth.js";
import { requireBusiness } from "../context.js";
import { usageError } from "../errors.js";
import { cell, formatTime, plural, table } from "../format.js";
import type { Command } from "./types.js";

// The API defaults to "trainer" (AI Trainer sandbox chats); a CLI user means customers.
const KINDS = ["real", "trainer", "all"];

function templateVariables(values: readonly string[]): Record<string, string> | undefined {
  if (values.length === 0) return undefined;
  return Object.fromEntries(
    values.map((value) => {
      const index = value.indexOf("=");
      if (index <= 0) throw usageError("--var must be in the form name=value, for example --var 1=Ana.");
      return [value.slice(0, index), value.slice(index + 1)];
    }),
  );
}

export const chatsList: Command = {
  name: "chats list",
  summary: "List conversations",
  flags: ["kind", "page", "page-size", "since"],
  help: `Usage: izap chats list [flags]

Lists the business's conversations, most recent activity first.

Flags
  --kind <kind>          real (default): WhatsApp customers; trainer: AI Trainer
                         sandbox chats; all: both
  --page <n>             Page to show, from 1 (default 1)
  --page-size <n>        Chats per page, 1 to 100 (default 30)
  --since <timestamp>    Only chats with activity after this ISO-8601 time
  --business <id>        Business to list (or IZAP_BUSINESS_ID / the profile default)`,

  async run(ctx, args) {
    assertNoArgs(args, "chats list");
    const kind = stringFlag(ctx.flags, "kind") ?? "real";
    if (!KINDS.includes(kind)) throw usageError(`--kind must be one of: ${KINDS.join(", ")}.`);
    const page = intFlag(ctx.flags, "page", { min: 1 });
    const pageSize = intFlag(ctx.flags, "page-size", { min: 1, max: 100 });
    const since = stringFlag(ctx.flags, "since");
    requireBusiness(ctx);

    const izap = await apiClient(ctx);
    const { data } = await izap.listCurrentBusinessChats({
      query: { kind, page, page_size: pageSize, since },
    });

    if (ctx.out.json) {
      ctx.out.data(data);
      return;
    }
    if (data.chats.length === 0) {
      ctx.out.line("No chats found.");
      return;
    }
    ctx.out.line(
      table(
        ["ID", "CONTACT", "LAST ACTIVITY", "LAST MESSAGE"],
        data.chats.map((chat) => [
          cell(chat.id),
          cell(chat.consumer?.nickname || chat.consumer?.phone_number, 30),
          formatTime(chat.timestamp),
          cell(chat.last_message?.content, 50),
        ]),
      ),
    );
    const { pagination } = data;
    const next = pagination.has_next ? `; next page: --page ${pagination.page + 1}` : "";
    ctx.out.line(
      `\nPage ${pagination.page} of ${Math.max(pagination.total_pages, 1)} (${plural(pagination.total_count, "chat")})${next}`,
    );
  },
};

export const chatsStartTemplate: Command = {
  name: "chats start-template",
  summary: "Start a conversation with a template",
  flags: ["template", "template-id", "phone", "name", "email", "whatsapp-number-id", "var"],
  help: `Usage: izap chats start-template --template <id> --phone <phone> [--name <name>] [--email <email>] [--whatsapp-number-id <id>] [--var 1=value ...]

Creates the contact if needed and sends an approved template to open the WhatsApp conversation.`,

  async run(ctx, args) {
    assertNoArgs(args, "chats start-template");
    requireBusiness(ctx);
    const templateId = stringFlag(ctx.flags, "template") ?? requiredString(ctx.flags, "template-id", "chats start-template");
    const izap = await apiClient(ctx);
    const { data } = await izap.startTemplateConversation({
      body: {
        template_id: templateId,
        phone: requiredString(ctx.flags, "phone", "chats start-template"),
        name: stringFlag(ctx.flags, "name"),
        email: stringFlag(ctx.flags, "email"),
        whatsapp_number_id: stringFlag(ctx.flags, "whatsapp-number-id"),
        variables: templateVariables(stringFlags(ctx.flags, "var")),
      },
    });

    if (ctx.out.json) {
      ctx.out.data(data);
      return;
    }
    ctx.out.line(`Started chat ${data.chat_id} for contact ${data.consumer_id}; sent message ${data.user_message.id}.`);
  },
};
