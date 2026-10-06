import { stdin, stdout } from "node:process";
import { createInterface, emitKeypressEvents } from "node:readline";
import { pathToFileURL } from "node:url";

import { Pool } from "pg";

import { hashPassword, MINIMUM_PASSWORD_LENGTH } from "../src/infrastructure/auth/password.ts";
import {
  databaseSsl,
  isLocalDatabaseHost,
  parseDatabaseEnv,
} from "../src/infrastructure/config/database-env.ts";

function redactDatabaseCredentials(message: string): string {
  return message.replace(/\b(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1***@");
}

function operatorErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactDatabaseCredentials(message);
}

function prompt(question: string): Promise<string> {
  const interface_ = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    interface_.question(question, (answer) => {
      interface_.close();
      resolve(answer);
    });
  });
}

function promptHidden(question: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) {
    throw new Error("La contraseña requiere una terminal interactiva");
  }

  stdout.write(question);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const onKeypress = (character: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Operación cancelada"));
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        stdout.write("\n");
        cleanup();
        resolve(value);
        return;
      }
      if (key.name === "backspace") {
        value = value.slice(0, -1);
        return;
      }
      if (character && !key.ctrl) {
        value += character;
      }
    };
    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on("keypress", onKeypress);
  });
}

export async function createAdmin(): Promise<void> {
  const databaseEnvironment = parseDatabaseEnv(process.env);
  const databaseUrl = new URL(databaseEnvironment.DATABASE_URL);
  if (
    databaseEnvironment.DATABASE_SSL_MODE === "disable" &&
    !isLocalDatabaseHost(databaseUrl.hostname)
  ) {
    throw new Error("DATABASE_SSL_MODE=disable solo se permite para una base de datos local");
  }
  stdout.write(
    `Destino: ${databaseUrl.hostname}:${databaseUrl.port || "5432"}${databaseUrl.pathname}\n`,
  );

  const email = (await prompt("Email: ")).trim();
  const displayName = (await prompt("Nombre para mostrar: ")).trim();
  const password = await promptHidden("Contraseña: ");
  const repeatedPassword = await promptHidden("Repite la contraseña: ");
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(`La contraseña debe tener al menos ${MINIMUM_PASSWORD_LENGTH} caracteres`);
  }
  if (password !== repeatedPassword) {
    throw new Error("Las contraseñas no coinciden");
  }

  const pool = new Pool({
    connectionString: databaseEnvironment.DATABASE_URL,
    connectionTimeoutMillis: 3_000,
    ssl: databaseSsl(databaseEnvironment),
  });
  try {
    await pool.query(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name, role)
       VALUES ($1, $2, $3, $4, 'SUPER_ADMIN')`,
      [email, email.toLowerCase(), await hashPassword(password), displayName],
    );
    stdout.write("Administrador creado.\n");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createAdmin().catch((error: unknown) => {
    console.error("No se pudo crear el administrador.");
    console.error(operatorErrorMessage(error));
    process.exitCode = 1;
  });
}
