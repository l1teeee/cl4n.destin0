import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresEventImageRepository } from "@/infrastructure/db/repositories/postgres-event-image-repository";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresEventImageRepository;
let adminId: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresEventImageRepository(pool);
});

beforeEach(async () => {
  await pool.end();
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresEventImageRepository(pool);
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ($1, $1, 'hash', 'Admin') RETURNING id`,
    [`${randomUUID()}@example.com`],
  );
  adminId = admin.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

async function event(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (
       slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at
     ) VALUES ($1, 'Images', now() + interval '2 days', 10, 2, now(), now() + interval '1 day')
     RETURNING id`,
    [`images-${randomUUID()}`],
  );
  return result.rows[0]!.id;
}

function add(eventId: string, marker: number) {
  return repository.add({
    eventId,
    contentType: "image/webp",
    data: Buffer.from([0x52, 0x49, 0x46, 0x46, marker, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    actorId: adminId,
  });
}

describe("event image repository", () => {
  it("adds, lists without data, gets, removes, and audits images", async () => {
    const eventId = await event();
    const added = await add(eventId, 1);
    if (!added.ok) throw new Error(added.error);

    const listed = await repository.list(eventId);
    expect(listed).toEqual([added.value]);
    expect(listed[0]).not.toHaveProperty("data");
    expect(listed[0]).not.toHaveProperty("publicToken");
    expect((await repository.get(eventId, added.value.id))?.data).toEqual(
      Buffer.from([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    );
    const token = await pool.query<{ public_token: string }>(
      "SELECT public_token FROM event_images WHERE id = $1",
      [added.value.id],
    );
    expect(await repository.getByPublicToken(token.rows[0]!.public_token)).toMatchObject({
      id: added.value.id,
      data: Buffer.from([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    });
    expect(await repository.remove(eventId, added.value.id, adminId)).toBe(true);
    expect(await repository.get(eventId, added.value.id)).toBeNull();
    await expect(
      pool.query("SELECT location_revision FROM events WHERE id = $1", [eventId]),
    ).resolves.toMatchObject({ rows: [{ location_revision: 0 }] });

    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_logs WHERE entity_id = $1 ORDER BY id",
      [eventId],
    );
    expect(audit.rows).toEqual([
      { metadata: { imageAdded: added.value.id, contentType: "image/webp", byteSize: 12 } },
      { metadata: { imageRemoved: added.value.id } },
    ]);
  });

  it("rejects the seventh image", async () => {
    const eventId = await event();
    for (let index = 0; index < 6; index += 1) {
      expect((await add(eventId, index)).ok).toBe(true);
    }
    await expect(add(eventId, 7)).resolves.toEqual({ ok: false, error: "MAX_IMAGES_REACHED" });
  });

  it("allows exactly one of two concurrent adds when five exist", async () => {
    const eventId = await event();
    for (let index = 0; index < 5; index += 1) await add(eventId, index);
    const results = await Promise.all([add(eventId, 8), add(eventId, 9)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(await repository.list(eventId)).toHaveLength(6);
  });

  it("does not remove an image through another event", async () => {
    const first = await event();
    const second = await event();
    const added = await add(first, 1);
    if (!added.ok) throw new Error(added.error);
    expect(await repository.remove(second, added.value.id, adminId)).toBe(false);
    expect(await repository.get(first, added.value.id)).not.toBeNull();
  });
});
