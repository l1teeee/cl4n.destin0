import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function localTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const target = new URL(value);
  if (target.protocol !== "postgres:" && target.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL must use PostgreSQL");
  }
  if (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") {
    throw new Error("Refusing to run the load-test server against a non-local database");
  }

  return target.toString();
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const databaseUrl = localTestDatabaseUrl();
const child = spawn(process.execPath, [nextBin, "start", "-p", "3100"], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    APP_ENV: "test",
    DATABASE_URL: databaseUrl,
    BOT_PROTECTION_MODE: "disabled",
    RATE_LIMIT_MODE: "disabled",
    DATABASE_POOL_MAX: "20",
  },
});

function stop(signal) {
  if (!child.killed) {
    child.kill(signal);
  }
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

child.on("error", () => {
  console.error("Load-test server failed to start.");
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
