import type { TemplateStatus } from "@izapai/sdk";

import { assertNoArgs, stringFlag } from "../args.js";
import { apiClient } from "../auth.js";
import { requireBusiness } from "../context.js";
import { usageError } from "../errors.js";
import { cell, plural, table } from "../format.js";
import type { Command } from "./types.js";

const STATUSES: readonly TemplateStatus[] = ["draft", "pending", "approved", "rejected", "paused", "disabled"];

export const templatesList: Command = {
  name: "templates list",
  summary: "List WhatsApp message templates",
  flags: ["status"],
  help: `Usage: izap templates list [--status <status>]

Lists the business's WhatsApp message templates.

Flags
  --status <status>    Only templates in this status: ${STATUSES.join(", ")}
  --business <id>      Business to list (or IZAP_BUSINESS_ID / the profile default)`,

  async run(ctx, args) {
    assertNoArgs(args, "templates list");
    const status = stringFlag(ctx.flags, "status");
    if (status !== undefined && !STATUSES.includes(status as TemplateStatus)) {
      throw usageError(`--status must be one of: ${STATUSES.join(", ")}.`);
    }
    requireBusiness(ctx);

    const izap = await apiClient(ctx);
    const { data } = await izap.listWhatsAppTemplates({
      query: status === undefined ? undefined : { status: status as TemplateStatus },
    });

    if (ctx.out.json) {
      ctx.out.data(data);
      return;
    }
    if (data.templates.length === 0) {
      ctx.out.line("No templates found.");
      return;
    }
    ctx.out.line(
      table(
        ["ID", "NAME", "LANGUAGE", "CATEGORY", "STATUS"],
        data.templates.map((template) => [
          cell(template.id),
          cell(template.name, 40),
          cell(template.language),
          cell(template.category),
          cell(template.status),
        ]),
      ),
    );
    ctx.out.line(`\n${plural(data.total_count, "template")}`);
  },
};
