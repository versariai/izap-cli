import { spawn } from "node:child_process";

/** Runs a command attached to this terminal and resolves with its exit code. */
export function runProcess(command: string, args: readonly string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    // Windows needs a shell to run npx.cmd (Node refuses to spawn .cmd files directly).
    const child =
      process.platform === "win32"
        ? spawn([command, ...args].map(quoteForCmd).join(" "), { stdio: "inherit", shell: true })
        : spawn(command, [...args], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

function quoteForCmd(arg: string): string {
  return /^[\w@./:=+-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`;
}
