import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { updateTemplate } from "@/application/messaging/message-templates";
import {
  messageTemplateAuditId,
  PostgresMessageTemplateRepository,
} from "@/infrastructure/db/repositories/postgres-message-template-repository";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresMessageTemplateRepository;
let adminId: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresMessageTemplateRepository(pool);
  const email = `${randomUUID()}@example.com`;
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ($1, $1, 'hash', 'Ana Admin') RETURNING id`,
    [email],
  );
  adminId = admin.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

describe("message template repository", () => {
  it("validates, updates, lists, audits, and uses a stable UUID v5", async () => {
    await expect(updateTemplate(repository, "ON_LIST", "   ", adminId)).resolves.toEqual({
      ok: false,
      message: "El mensaje no puede estar vacío.",
    });
    await expect(
      updateTemplate(repository, "ON_LIST", "Hola {variable}", adminId),
    ).resolves.toEqual({
      ok: false,
      message: "Estas variables no existen para este mensaje: variable.",
    });
    await expect(
      updateTemplate(repository, "ON_LIST", "{pago}".repeat(4), adminId),
    ).resolves.toEqual({
      ok: false,
      message:
        "Con los datos más largos posibles este mensaje superaría el límite de Instagram. Acórtalo.",
    });

    const result = await updateTemplate(
      repository,
      "ON_LIST",
      "  Hola {nombres}.\n\nPaga así: {pago}.  ",
      adminId,
    );
    expect(result).toMatchObject({
      ok: true,
      template: {
        key: "ON_LIST",
        body: "Hola {nombres}.\n\nPaga así: {pago}.",
        updatedBy: "Ana Admin",
      },
    });
    const listed = await repository.listTemplates();
    expect(listed).toHaveLength(10);
    expect(listed.find((template) => template.key === "ON_LIST")).toMatchObject({
      body: "Hola {nombres}.\n\nPaga así: {pago}.",
      updatedBy: "Ana Admin",
    });

    const entityId = messageTemplateAuditId("ON_LIST");
    expect(messageTemplateAuditId("ON_LIST")).toBe(entityId);
    expect(entityId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const audit = await pool.query<{
      actor_type: string;
      actor_admin_id: string;
      entity_type: string;
      entity_id: string;
      metadata: { key: string };
    }>(
      `SELECT actor_type, actor_admin_id, entity_type, entity_id, metadata
         FROM audit_logs WHERE action = 'MESSAGE_TEMPLATE_UPDATED'`,
    );
    expect(audit.rows).toEqual([
      {
        actor_type: "ADMIN",
        actor_admin_id: adminId,
        entity_type: "MESSAGE_TEMPLATE",
        entity_id: entityId,
        metadata: { key: "ON_LIST" },
      },
    ]);
  });
});
