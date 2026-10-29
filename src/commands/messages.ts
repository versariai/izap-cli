import { assertNoArgs, requiredString } from "../args.js";
import { apiClient } from "../auth.js";
import { confirmSend } from "../context.js";
import { cell } from "../format.js";
import type { Command } from "./types.js";

export const messagesSend: Command = {
  name: "messages send",
  summary: "Send a WhatsApp message to a chat (asks you to confirm)",
  flags: ["chat", "text", "yes"],
  help: `Usage: izap messages send --chat <id> --text <text> [--yes]

Sends a WhatsApp message into an existing chat, as a human agent (the AI assistant
does not reply to it). It reaches a real customer and cannot be undone, so the CLI
asks you to confirm; pass --yes to skip the question (required when stdin is not a
terminal, e.g. in scripts). Outside WhatsApp's 24-hour customer-service window only
an approved template can reach the customer.

Flags
  --chat <id>      Chat to send to (see \`izap chats list\`)
  --text <text>    Message text
  -y, --yes        Send without asking`,

  async run(ctx, args) {
    assertNoArgs(args, "messages send");
    const chatId = requiredString(ctx.flags, "chat", "messages send").trim();
    const text = requiredString(ctx.flags, "text", "messages send");

    const izap = await apiClient(ctx);
    await confirmSend(
      ctx,
      `Send this WhatsApp message to chat ${cell(chatId)}?\n\n  ${cell(text, 200)}\n\nIt goes to a real customer and cannot be undone. Send? [y/N] `,
    );
    const { data } = await izap.sendChatMessage({
      path: { chat_id: chatId },
      body: { content: text },
    });

    if (ctx.out.json) {
      ctx.out.data(data);
      return;
    }
    const message = data.user_message;
    ctx.out.line(`Sent message ${message.id} to chat ${chatId} (status: ${message.status ?? "pending"}).`);
    if (message.error_code !== null && message.error_code !== undefined) {
      ctx.out.note(
        `WhatsApp reported error ${message.error_code}${message.error_reason ? `: ${cell(message.error_reason, 200)}` : ""}.`,
      );
    }
  },
};
