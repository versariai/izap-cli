import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { assertNoArgs, intFlag, requiredString, stringFlag, stringFlags } from "../args.js";
import { apiClient } from "../auth.js";
import { requireBusiness } from "../context.js";
import { usageError } from "../errors.js";
import { cell, plural, table } from "../format.js";
import type { Command } from "./types.js";

export const stickersList: Command = {
  name: "library stickers list",
  summary: "List library stickers",
  flags: ["limit", "offset"],
  help: `Usage: izap library stickers list [--limit <n>] [--offset <n>]

Lists WhatsApp stickers in the selected business's library.`,

  async run(ctx, args) {
    assertNoArgs(args, "library stickers list");
    requireBusiness(ctx);
    const { data } = await (await apiClient(ctx)).listBusinessLibraryStickers({
      query: {
        limit: intFlag(ctx.flags, "limit", { min: 1, max: 100 }),
        offset: intFlag(ctx.flags, "offset", { min: 0 }),
      },
    });
    if (ctx.out.json) {
      ctx.out.data(data);
      return;
    }
    if (data.stickers.length === 0) {
      ctx.out.line("No stickers found.");
      return;
    }
    ctx.out.line(
      table(
        ["ID", "TITLE", "DESCRIPTION", "TAGS"],
        data.stickers.map((sticker) => [
          cell(sticker.id),
          cell(sticker.title, 30),
          cell(sticker.description, 40),
          cell(Array.isArray(sticker.tags) ? sticker.tags.join(", ") : sticker.tags),
        ]),
      ),
    );
    ctx.out.line(`\nShowing ${data.stickers.length} of ${plural(data.total, "sticker")}.`);
  },
};

export const stickersUpload: Command = {
  name: "library stickers upload",
  summary: "Upload a library sticker",
  flags: ["title", "description", "tags"],
  help: `Usage: izap library stickers upload <file.webp> [--title <text>] [--description <text>] [--tags <csv>]`,

  async run(ctx, args) {
    const [file, ...rest] = args;
    if (!file) throw usageError("`izap library stickers upload` needs a WebP file.");
    assertNoArgs(rest, "library stickers upload");
    requireBusiness(ctx);
    const bytes = readFileSync(file);
    const body = {
      file: new File([bytes], basename(file), { type: "image/webp" }),
      title: stringFlag(ctx.flags, "title"),
      description: stringFlag(ctx.flags, "description"),
      tags: stringFlags(ctx.flags, "tags").join(",") || undefined,
    };
    const { data } = await (await apiClient(ctx)).uploadBusinessLibrarySticker({ body });
    if (ctx.out.json) ctx.out.data(data);
    else ctx.out.line(`Uploaded sticker ${data.id} (${cell(data.title || basename(file))}).`);
  },
};

export const stickersDelete: Command = {
  name: "library stickers delete",
  summary: "Delete a library sticker",
  flags: [],
  help: "Usage: izap library stickers delete <id>",

  async run(ctx, args) {
    const [id, ...rest] = args;
    if (!id) throw usageError("`izap library stickers delete` needs a sticker id.");
    assertNoArgs(rest, "library stickers delete");
    requireBusiness(ctx);
    await (await apiClient(ctx)).deleteBusinessLibrarySticker({ path: { sticker_id: id } });
    if (ctx.out.json) ctx.out.data({ deleted: true, id });
    else ctx.out.line(`Deleted sticker ${id}.`);
  },
};
