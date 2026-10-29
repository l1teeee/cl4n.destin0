import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DrinkImageFile } from "@/application/drinks/drink-repository";
import { PostgresDrinkRepository } from "@/infrastructure/db/repositories/postgres-drink-repository";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresDrinkRepository;
let adminId: string;

const image: DrinkImageFile = {
  contentType: "image/webp",
  data: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
};

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresDrinkRepository(pool);
});

beforeEach(async () => {
  await pool.end();
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresDrinkRepository(pool);
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

function create(
  options: { image?: DrinkImageFile | null; isVisible?: boolean; name?: string } = {},
) {
  return repository.create({
    name: options.name ?? "Vino de la casa",
    description: "Copa",
    priceCents: 450,
    isVisible: options.isVisible ?? true,
    image: options.image ?? null,
    actorId: adminId,
  });
}

describe("drink repository", () => {
  it("creates with and without an image and lists without bytes", async () => {
    const withoutImage = await create({ name: "Agua" });
    const withImage = await create({ name: "Vino", image });

    expect(withoutImage.imageId).toBeNull();
    expect(withImage.imageId).not.toBeNull();
    const listed = await repository.listForAdmin();
    expect(listed).toEqual([withoutImage, withImage]);
    expect(listed.every((drink) => !("data" in drink))).toBe(true);
    expect(await repository.get(withImage.id)).not.toHaveProperty("data");
    await expect(repository.getImage(withImage.imageId!)).resolves.toMatchObject({
      id: withImage.imageId,
      contentType: "image/webp",
      data: image.data,
    });
  });

  it("never selects image bytes outside getImage", async () => {
    const drink = await create({ image });
    const query = vi.spyOn(pool, "query");

    await repository.get(drink.id);
    await repository.listForAdmin();
    await repository.listVisible();

    const statements = query.mock.calls.map(([statement]) => String(statement));
    query.mockRestore();
    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      expect(statement).not.toMatch(/\bdata\b/i);
    }
  });

  it("lists only visible drinks in creation order", async () => {
    const visible = await create({ name: "Visible" });
    await create({ name: "Oculta", isVisible: false });
    expect(await repository.listVisible()).toEqual([
      {
        id: visible.id,
        name: visible.name,
        description: visible.description,
        priceCents: visible.priceCents,
        imageId: visible.imageId,
      },
    ]);
  });

  it("updates fields, replaces with a new image id, and removes the old row", async () => {
    const drink = await create({ image });
    const oldImageId = drink.imageId!;
    const replacement: DrinkImageFile = {
      contentType: "image/png",
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    };
    const updated = await repository.update({
      id: drink.id,
      name: "Espumante",
      description: null,
      priceCents: 725,
      isVisible: false,
      image: { kind: "replace", image: replacement },
      actorId: adminId,
    });

    expect(updated).toMatchObject({
      name: "Espumante",
      description: null,
      priceCents: 725,
      isVisible: false,
    });
    expect(updated?.imageId).not.toBe(oldImageId);
    expect(await repository.getImage(oldImageId)).toBeNull();
    await expect(
      pool.query("SELECT count(*)::int AS count FROM drink_images WHERE drink_id = $1", [drink.id]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });

    const removed = await repository.update({
      id: drink.id,
      name: "Espumante",
      description: null,
      priceCents: 725,
      isVisible: true,
      image: { kind: "remove" },
      actorId: adminId,
    });
    expect(removed?.imageId).toBeNull();
    await expect(
      pool.query("SELECT count(*)::int AS count FROM drink_images WHERE drink_id = $1", [drink.id]),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it("audits whether an update replaced or removed the image", async () => {
    const drink = await create({ image });
    const details = {
      id: drink.id,
      name: "Vino",
      description: null,
      priceCents: 450,
      isVisible: true,
      actorId: adminId,
    };
    await repository.update({ ...details, image: { kind: "replace", image } });
    await repository.update({ ...details, image: { kind: "remove" } });

    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_logs WHERE entity_id = $1 AND action = 'DRINK_UPDATED' ORDER BY id",
      [drink.id],
    );
    expect(audit.rows.map((row) => row.metadata.image)).toEqual(["replaced", "removed"]);
  });

  it("deletes the drink, cascades its image, and writes complete audit metadata", async () => {
    const drink = await create({ image });
    const imageId = drink.imageId!;
    await repository.update({
      id: drink.id,
      name: "Vino reserva",
      description: "Botella",
      priceCents: 1500,
      isVisible: true,
      image: { kind: "keep" },
      actorId: adminId,
    });
    expect(await repository.delete(drink.id, adminId)).toBe(true);
    expect(await repository.getImage(imageId)).toBeNull();

    const audit = await pool.query<{
      action: string;
      entity_type: string;
      metadata: Record<string, unknown>;
    }>("SELECT action, entity_type, metadata FROM audit_logs WHERE entity_id = $1 ORDER BY id", [
      drink.id,
    ]);
    expect(audit.rows).toEqual([
      {
        action: "DRINK_CREATED",
        entity_type: "DRINK",
        metadata: { name: "Vino de la casa", priceCents: 450, isVisible: true, hasImage: true },
      },
      {
        action: "DRINK_UPDATED",
        entity_type: "DRINK",
        metadata: { name: "Vino reserva", priceCents: 1500, isVisible: true, image: "kept" },
      },
      {
        action: "DRINK_DELETED",
        entity_type: "DRINK",
        metadata: { name: "Vino reserva", priceCents: 1500 },
      },
    ]);
  });

  it("returns null and false for an unknown drink", async () => {
    const id = randomUUID();
    await expect(
      repository.update({
        id,
        name: "Missing",
        description: null,
        priceCents: 100,
        isVisible: true,
        image: { kind: "keep" },
        actorId: adminId,
      }),
    ).resolves.toBeNull();
    await expect(repository.delete(id, adminId)).resolves.toBe(false);
  });

  it("enforces drink and image database checks", async () => {
    await expect(
      pool.query(`INSERT INTO drinks (name, price_cents, created_by) VALUES ('Gratis', 0, $1)`, [
        adminId,
      ]),
    ).rejects.toMatchObject({ constraint: "drinks_price_cents_chk" });
    await expect(
      pool.query(`INSERT INTO drinks (name, price_cents, created_by) VALUES ($1, 100, $2)`, [
        "a".repeat(81),
        adminId,
      ]),
    ).rejects.toMatchObject({ constraint: "drinks_name_length_chk" });

    const drink = await create({ image });
    await expect(
      pool.query(
        `INSERT INTO drink_images (drink_id, content_type, byte_size, data, created_by)
         VALUES ($1, 'image/webp', $2, $3, $4)`,
        [drink.id, image.data.byteLength, Buffer.from(image.data), adminId],
      ),
    ).rejects.toMatchObject({ constraint: "drink_images_drink_uq" });

    const secondDrink = await create();
    await expect(
      pool.query(
        `INSERT INTO drink_images (drink_id, content_type, byte_size, data, created_by)
         VALUES ($1, 'image/webp', 99, $2, $3)`,
        [secondDrink.id, Buffer.from(image.data), adminId],
      ),
    ).rejects.toMatchObject({ constraint: "drink_images_data_size_chk" });
  });
});
