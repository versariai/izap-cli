import { assertNoArgs, intFlag, stringFlag } from "../args.js";
import { apiClient } from "../auth.js";
import { requireBusiness } from "../context.js";
import { usageError } from "../errors.js";
import { cell, fields, formatTime, table } from "../format.js";
import type { Command } from "./types.js";

export const transmissionsList: Command = {
  name: "transmissions list",
  summary: "List bulk transmissions",
  flags: ["status", "limit"],
  help: `Usage: izap transmissions list [--status <status>] [--limit <n>]

Lists the business's bulk transmissions (template broadcasts), newest first.

Flags
  --status <status>    Only transmissions in this status, e.g. draft, sending, completed
  --limit <n>          How many to return
  --business <id>      Business to list (or IZAP_BUSINESS_ID / the profile default)`,

  async run(ctx, args) {
    assertNoArgs(args, "transmissions list");
    const status = stringFlag(ctx.flags, "status");
    const limit = intFlag(ctx.flags, "limit", { min: 1 });
    requireBusiness(ctx);

    const izap = await apiClient(ctx);
    const { data } = await izap.listTransmissions({ query: { status, limit } });

    if (ctx.out.json) {
      ctx.out.data(data);
      return;
    }
    if (data.transmissions.length === 0) {
      ctx.out.line("No transmissions found.");
      return;
    }
    ctx.out.line(
      table(
        ["ID", "NAME", "STATUS", "TEMPLATE", "SENT", "FAILED", "TOTAL", "CREATED"],
        data.transmissions.map((transmission) => [
          cell(transmission.transmission_id),
          cell(transmission.name, 30),
          cell(transmission.status),
          cell(transmission.template_name, 30),
          cell(transmission.sent_count),
          cell(transmission.failed_count),
          cell(transmission.total_recipients),
          formatTime(transmission.created),
        ]),
      ),
    );
    ctx.out.line(`\nShowing ${data.transmissions.length} of ${data.total}.`);
  },
};

export const transmissionsShow: Command = {
  name: "transmissions show",
  summary: "Show one transmission",
  flags: [],
  help: `Usage: izap transmissions show <id>

Shows a bulk transmission's status and delivery counts.

Flags
  --business <id>    Business it belongs to (or IZAP_BUSINESS_ID / the profile default)`,

  async run(ctx, args) {
    const [id, ...rest] = args;
    if (!id || id.trim() === "") {
      throw usageError("`izap transmissions show` needs a transmission id.", "Usage: izap transmissions show <id>");
    }
    assertNoArgs(rest, "transmissions show");
    requireBusiness(ctx);

    const izap = await apiClient(ctx);
    const { data } = await izap.getTransmission({ path: { transmission_id: id.trim() } });

    if (ctx.out.json) {
      ctx.out.data(data);
      return;
    }
    const detailed = data as typeof data & {
      outside_window_count?: number;
      warning_details?: Array<{ code: string; message: string; variable?: string | null }>;
    };
    ctx.out.line(
      fields([
        ["ID", data.transmission_id],
        ["Name", data.name],
        ["Status", data.status],
        ["Type", data.transmission_type],
        ["Template", data.template_name],
        ["Recipients", data.total_recipients],
        ["Sent", data.sent_count],
        ["Failed", data.failed_count],
        ["Pending", data.pending_count],
        ["Outside window", detailed.outside_window_count],
        ["Progress", `${data.progress_pct}%`],
        ["Scheduled", formatTime(data.scheduled_at)],
        ["Started", formatTime(data.started_at)],
        ["Completed", formatTime(data.completed_at)],
        ["Created", formatTime(data.created)],
      ]),
    );
    if (Array.isArray(detailed.warning_details) && detailed.warning_details.length > 0) {
      ctx.out.line("\nWarnings");
      ctx.out.line(
        table(
          ["CODE", "VARIABLE", "MESSAGE"],
          detailed.warning_details.map((warning) => [cell(warning.code), cell(warning.variable), cell(warning.message, 80)]),
        ),
      );
    }
  },
};
