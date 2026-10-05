import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const PORT = 54329;
const projectRoot = process.cwd();
const localDir = path.join(projectRoot, ".local");
const dataDir = path.join(localDir, "postgres");
const logFile = path.join(localDir, "postgres.log");

const platformPackages = {
  "win32-x64": "@embedded-postgres/windows-x64",
  "darwin-arm64": "@embedded-postgres/darwin-arm64",
  "darwin-x64": "@embedded-postgres/darwin-x64",
  "linux-x64": "@embedded-postgres/linux-x64",
  "linux-arm64": "@embedded-postgres/linux-arm64",
};

const platformKey = `${process.platform}-${process.arch}`;
const platformPackage = platformPackages[platformKey];

if (!platformPackage) {
  throw new Error(`Unsupported PostgreSQL platform: ${platformKey}`);
}

const packageEntry = fileURLToPath(import.meta.resolve(platformPackage));
const packageRoot = path.dirname(path.dirname(packageEntry));
const binDir = path.join(packageRoot, "native", "bin");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const commandEnvironment = {
  ...process.env,
  PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
};

function binary(name) {
  const binaryPath = path.join(binDir, `${name}${executableSuffix}`);
  if (!existsSync(binaryPath)) {
    throw new Error(`PostgreSQL binary not found: ${binaryPath}`);
  }
  return binaryPath;
}

function run(name, args, options = {}) {
  const result = spawnSync(binary(name), args, {
    cwd: projectRoot,
    env: commandEnvironment,
    stdio: options.stdio ?? "inherit",
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${name} exited with status ${result.status}`);
  }
}

async function isRunning() {
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    return false;
  }

  const client = new pg.Client({
    host: "127.0.0.1",
    port: PORT,
    user: "postgres",
    password: "postgres",
    database: "postgres",
    connectionTimeoutMillis: 500,
  });

  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function initializeCluster() {
  if (existsSync(path.join(dataDir, "PG_VERSION"))) {
    return;
  }

  await mkdir(localDir, { recursive: true });
  const passwordFile = path.join(localDir, `init-password-${process.pid}.txt`);
  await writeFile(passwordFile, "postgres\n", { encoding: "utf8", mode: 0o600 });

  try {
    run("initdb", [
      "-D",
      dataDir,
      "-U",
      "postgres",
      `--pwfile=${passwordFile}`,
      "--auth=scram-sha-256",
      "-E",
      "UTF8",
      "--locale=C",
    ]);
  } finally {
    await unlink(passwordFile).catch(() => undefined);
  }
}

async function ensureDatabases() {
  const client = new pg.Client({
    host: "127.0.0.1",
    port: PORT,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });

  await client.connect();
  try {
    for (const database of ["cl4n_dev", "cl4n_test"]) {
      const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
      if (result.rowCount === 0) {
        await client.query(`CREATE DATABASE ${database}`);
        console.log(`Created database ${database}`);
      }
    }
  } finally {
    await client.end();
  }
}

async function start() {
  await initializeCluster();

  if (await isRunning()) {
    console.log(`PostgreSQL already running on 127.0.0.1:${PORT}`);
  } else {
    try {
      run(
        "pg_ctl",
        [
          "start",
          "-w",
          "-D",
          dataDir,
          "-l",
          logFile,
          "-o",
          `-p ${PORT} -c listen_addresses=127.0.0.1 -c max_connections=200`,
        ],
        { stdio: "ignore" },
      );
    } catch (error) {
      if (existsSync(logFile)) {
        console.error(`PostgreSQL log: ${logFile}`);
        try {
          const log = await readFile(logFile, "utf8");
          const tail = log.trimEnd().split(/\r?\n/).slice(-20).join("\n");
          console.error(tail || "(log file is empty)");
        } catch (logError) {
          console.error(`Could not read PostgreSQL log: ${String(logError)}`);
        }
      } else {
        console.error("PostgreSQL failed to start and did not create a log file.");
      }

      throw new Error(`pg_ctl failed to start PostgreSQL on 127.0.0.1:${PORT}`, {
        cause: error,
      });
    }
    console.log(`PostgreSQL started on 127.0.0.1:${PORT}`);
  }

  await ensureDatabases();
}

async function stop() {
  if (!(await isRunning())) {
    console.log("PostgreSQL already stopped");
    return;
  }
  run("pg_ctl", ["stop", "-D", dataDir, "-m", "fast"]);
  console.log("PostgreSQL stopped");
}

async function status() {
  console.log(`status: ${(await isRunning()) ? "running" : "stopped"}`);
  console.log(`port: ${PORT}`);
  console.log(`data: ${dataDir}`);
}

const command = process.argv[2];

if (command === "start") {
  await start();
} else if (command === "stop") {
  await stop();
} else if (command === "status") {
  await status();
} else {
  throw new Error("Usage: node scripts/local-db.mjs <start|stop|status>");
}

process.exit(0);
