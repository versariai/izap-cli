import { readFileSync } from "node:fs";

import type {
  ContactCreateIn,
  ContactImportRowIn,
  ContactUpdateIn,
} from "@izapai/sdk";

import {
  assertNoArgs,
  intFlag,
  requiredString,
  stringFlag,
  stringFlags,
} from "../args.js";
import { apiClient } from "../auth.js";
import { requireBusiness } from "../context.js";
import { usageError } from "../errors.js";
import { cell, fields, formatTime, plural, table } from "../format.js";
import type { Command } from "./types.js";

type RawContactImportRow = Omit<Partial<ContactImportRowIn>, "tags"> & {
  phone?: string | null;
  phone_number?: string | null;
  tags?: string | string[] | null;
};

function cleanObject(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}

function normalizeContactImportRow(
  row: RawContactImportRow,
): ContactImportRowIn {
  const tags =
    typeof row.tags === "string"
      ? row.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : row.tags;

  return cleanObject({
    name: row.name,
    email: row.email,
    phone_number: row.phone_number ?? row.phone,
    tags: tags && tags.length > 0 ? tags : undefined,
  }) as ContactImportRowIn;
}

function parseCsv(text: string): ContactImportRowIn[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];
  const headers = lines[0]!.split(",").map((value) => value.trim());
  if (!headers.includes("phone_number") && !headers.includes("phone")) {
    throw usageError(
      "Contact import CSV needs a phone_number or phone column.",
    );
  }
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((value) => value.trim());
    const row = Object.fromEntries(
      headers.map((header, index) => [header, cells[index] ?? null]),
    ) as RawContactImportRow;
    return normalizeContactImportRow(row);
  });
}

function loadRows(
  args: readonly string[],
  jsonRows: string | undefined,
): ContactImportRowIn[] {
  if (jsonRows !== undefined) {
    const parsed = JSON.parse(jsonRows) as unknown;
    if (!Array.isArray(parsed))
      throw usageError("--json-rows must be a JSON array of contact rows.");
    return parsed.map((row) =>
      normalizeContactImportRow(row as RawContactImportRow),
    );
  }
  const [file, ...rest] = args;
  if (!file)
    throw usageError(
      "`izap contacts import` needs a .csv or .json file.",
      "Usage: izap contacts import <file>",
    );
  assertNoArgs(rest, "contacts import");
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".json")) {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed))
      throw usageError("Contact import JSON must be an array of rows.");
    return parsed.map((row) =>
      normalizeContactImportRow(row as RawContactImportRow),
    );
  }
  return parseCsv(text);
}

function printContact(
  ctx: Parameters<Command["run"]>[0],
  contact: Record<string, unknown>,
): void {
  ctx.out.line(
    fields([
      ["ID", contact.id],
      ["Name", contact.name],
      ["Phone", contact.phone_number],
      ["Email", contact.email],
      [
        "Tags",
        Array.isArray(contact.tags) ? contact.tags.join(", ") : undefined,
      ],
      ["Notes", contact.notes],
      ["Created", formatTime(contact.created_at as string | null | undefined)],
      [
        "Last interaction",
        formatTime(contact.last_interaction_at as string | null | undefined),
      ],
      ["Conversation", contact.conversation_id],
    ]),
  );
}

export const contactsList: Command = {
  name: "contacts list",
  summary: "List contacts",
  flags: ["search", "chatbot-id", "page", "page-size"],
  help: `Usage: izap contacts list [--search <text>] [--chatbot-id <id>] [--page <n>] [--page-size <n>]

Lists contacts for the selected business.

Flags
  --search <text>       Match by name, phone or email
  --chatbot-id <id>     Only contacts linked to one assistant
  --page <n>            Page to show, from 1
  --page-size <n>       Contacts per page, 1 to 100
  --business <id>       Business to list`,

  async run(ctx, args) {
    assertNoArgs(args, "contacts list");
    requireBusiness(ctx);
    const izap = await apiClient(ctx);
    const { data } = await izap.listContacts({
      query: {
        search: stringFlag(ctx.flags, "search"),
        chatbot_id: stringFlag(ctx.flags, "chatbot-id"),
        page: intFlag(ctx.flags, "page", { min: 1 }),
        page_size: intFlag(ctx.flags, "page-size", { min: 1, max: 100 }),
      },
    });

    if (ctx.out.json) {
      ctx.out.data(data);
      return;
    }
    const items = data.items ?? [];
    if (items.length === 0) {
      ctx.out.line("No contacts found.");
      return;
    }
    ctx.out.line(
      table(
        ["ID", "NAME", "PHONE", "EMAIL", "LAST INTERACTION"],
        items.map((contact) => [
          cell(contact.id),
          cell(contact.name, 30),
          cell(contact.phone_number),
          cell(contact.email, 30),
          formatTime(contact.last_interaction_at),
        ]),
      ),
    );
    ctx.out.line(`\nPage ${data.page} (${plural(data.total, "contact")}).`);
  },
};

export const contactsCreate: Command = {
  name: "contacts create",
  summary: "Create a contact",
  flags: ["name", "phone", "email", "tag", "notes"],
  help: `Usage: izap contacts create --name <name> --phone <phone> [--email <email>] [--tag <tag> ...] [--notes <text>]`,

  async run(ctx, args) {
    assertNoArgs(args, "contacts create");
    requireBusiness(ctx);
    const body = cleanObject({
      name: requiredString(ctx.flags, "name", "contacts create"),
      phone_number: requiredString(ctx.flags, "phone", "contacts create"),
      email: stringFlag(ctx.flags, "email"),
      tags: stringFlags(ctx.flags, "tag"),
      notes: stringFlag(ctx.flags, "notes"),
    }) as ContactCreateIn;
    const { data } = await (await apiClient(ctx)).createContact({ body });
    if (ctx.out.json) ctx.out.data(data);
    else
      ctx.out.line(
        `Created contact ${data.id} (${cell(data.name || data.phone_number)}).`,
      );
  },
};

export const contactsImport: Command = {
  name: "contacts import",
  summary: "Import contacts",
  flags: ["yes", "json-rows"],
  help: `Usage: izap contacts import <file.csv|file.json> [--yes]

Imports contacts for the selected business. JSON files must contain an array of rows; CSV files need headers.`,

  async run(ctx, args) {
    requireBusiness(ctx);
    const rows = loadRows(args, stringFlag(ctx.flags, "json-rows"));
    if (rows.length === 0) throw usageError("No contact rows to import.");
    const { data } = await (
      await apiClient(ctx)
    ).importContacts({ body: { rows } });
    if (ctx.out.json) ctx.out.data(data);
    else
      ctx.out.line(
        `Imported contacts: created ${data.created}, updated ${data.updated}, skipped ${data.skipped.length}.`,
      );
  },
};

export const contactsShow: Command = {
  name: "contacts show",
  summary: "Show one contact",
  flags: [],
  help: "Usage: izap contacts show <id>",

  async run(ctx, args) {
    const [id, ...rest] = args;
    if (!id) throw usageError("`izap contacts show` needs a contact id.");
    assertNoArgs(rest, "contacts show");
    requireBusiness(ctx);
    const { data } = await (
      await apiClient(ctx)
    ).getContact({ path: { contact_id: id } });
    if (ctx.out.json) ctx.out.data(data);
    else printContact(ctx, data as unknown as Record<string, unknown>);
  },
};

export const contactsUpdate: Command = {
  name: "contacts update",
  summary: "Update a contact",
  flags: ["name", "email", "tag", "notes"],
  help: `Usage: izap contacts update <id> [--name <name>] [--email <email>] [--tag <tag> ...] [--notes <text>]`,

  async run(ctx, args) {
    const [id, ...rest] = args;
    if (!id) throw usageError("`izap contacts update` needs a contact id.");
    assertNoArgs(rest, "contacts update");
    requireBusiness(ctx);
    const body = cleanObject({
      name: stringFlag(ctx.flags, "name"),
      email: stringFlag(ctx.flags, "email"),
      tags:
        stringFlags(ctx.flags, "tag").length > 0
          ? stringFlags(ctx.flags, "tag")
          : undefined,
      notes: stringFlag(ctx.flags, "notes"),
    }) as ContactUpdateIn;
    if (Object.keys(body).length === 0)
      throw usageError("Pass at least one field to update.");
    const { data } = await (
      await apiClient(ctx)
    ).updateContact({ path: { contact_id: id }, body });
    if (ctx.out.json) ctx.out.data(data);
    else
      ctx.out.line(
        `Updated contact ${data.id} (${cell(data.name || data.phone_number)}).`,
      );
  },
};
