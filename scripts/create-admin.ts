import { stdin, stdout } from "node:process";
import { createInterface, emitKeypressEvents } from "node:readline";
import { pathToFileURL } from "node:url";

import { Pool } from "pg";

import { hashPassword, MINIMUM_PASSWORD_LENGTH } from "../src/infrastructure/auth/password.ts";

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
  const databaseUrlValue = process.env.DATABASE_URL;
  if (!databaseUrlValue) {
    throw new Error("DATABASE_URL es obligatoria");
  }
  const databaseUrl = new URL(databaseUrlValue);
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

  const pool = new Pool({ connectionString: databaseUrlValue, ssl: false });
  try {
    await pool.query(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
       VALUES ($1, $2, $3, $4)`,
      [email, email.toLowerCase(), await hashPassword(password), displayName],
    );
    stdout.write("Administrador creado.\n");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createAdmin().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "No se pudo crear el administrador");
    process.exitCode = 1;
  });
}
