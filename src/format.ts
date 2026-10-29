// C0/C1 controls, so text from customers cannot inject terminal escape sequences.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]+/g;

/** One table cell or field value: printable, single-line and truncated. */
export function cell(value: unknown, max = 60): string {
  if (value === null || value === undefined || value === "") return "-";
  const text = String(value).replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text || "-";
}

export function table(headers: readonly string[], rows: readonly string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => Array.from(row[index] ?? "").length)),
  );
  const render = (row: readonly string[]) =>
    row
      .map((value, index) =>
        index === row.length - 1 ? value : value + " ".repeat(widths[index]! - Array.from(value).length),
      )
      .join("  ")
      .trimEnd();
  return [render(headers), ...rows.map(render)].join("\n");
}

/** Aligned `Label  value` lines. */
export function fields(pairs: ReadonlyArray<readonly [string, unknown]>): string {
  const width = Math.max(...pairs.map(([label]) => label.length));
  return pairs.map(([label, value]) => `${label.padEnd(width)}  ${cell(value, 200)}`).join("\n");
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cell(value);
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
