import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

// Vitest triggers a `net use` probe blocked by the Codex Windows sandbox; this shim is inert unless CODEX_CI=1.
if (process.platform === "win32" && process.env.CODEX_CI === "1") {
  const exec = childProcess.exec;

  childProcess.exec = (command, ...args) => {
    if (command === "net use") {
      const callback = args.find((value) => typeof value === "function");
      queueMicrotask(() => callback?.(new Error("Mapped-drive probe disabled"), "", ""));
      return undefined;
    }

    return exec(command, ...args);
  };

  syncBuiltinESMExports();
}
