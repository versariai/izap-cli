import { createInterface } from "node:readline/promises";

import { CliError } from "./errors.js";

/** Reads a line from the terminal without echoing it. */
export function promptSecret(question: string, input: NodeJS.ReadStream, output: NodeJS.WritableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!input.isTTY) {
      reject(new CliError("usage", "Cannot prompt for a token: stdin is not a terminal."));
      return;
    }
    const wasRaw = input.isRaw;
    try {
      input.setRawMode(true);
    } catch {
      reject(
        new CliError("usage", "Cannot prompt for a token: this terminal cannot hide input.", {
          hint: "Pipe the token on stdin instead: izap login < token.txt",
        }),
      );
      return;
    }
    output.write(question);
    let value = "";
    input.setEncoding("utf8");
    input.resume();

    const finish = (error?: Error) => {
      input.off("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") return finish();
        if (char === "\u0003") return finish(new CliError("cancelled", "Cancelled."));
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    input.on("data", onData);
  });
}

/** Asks a yes/no question; anything but y/yes (or Ctrl-C) is a no. */
export async function confirm(
  question: string,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<boolean> {
  const rl = createInterface({ input, output, terminal: true });
  const controller = new AbortController();
  rl.on("SIGINT", () => controller.abort());
  try {
    const answer = await rl.question(question, { signal: controller.signal });
    return /^y(es)?$/i.test(answer.trim());
  } catch (error) {
    if (controller.signal.aborted) {
      output.write("\n");
      return false;
    }
    throw error;
  } finally {
    rl.close();
  }
}

export async function readStdin(input: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8");
}
