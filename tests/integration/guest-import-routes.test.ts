import { randomUUID } from "node:crypto";

import * as Sentry from "@sentry/nextjs";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_IMPORT_FILE_BYTES,
  type ImportPreviewResponse,
  type ImportRunResponse,
} from "@/contracts/guest-import";
import { scheduleMessageDelivery } from "@/infrastructure/messaging/schedule-message-delivery";
import { consume } from "@/infrastructure/rate-limit/postgres-rate-limiter";

import { insertTestEvent } from "../helpers/reservation-test-data";
import { resetTestDatabase } from "../helpers/test-db";

const state = vi.hoisted(() => ({ authorized: true, sameOrigin: true, adminId: "" }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/infrastructure/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () =>
    state.authorized
      ? { authorized: true, session: { admin: { id: state.adminId } } }
      : { authorized: false, error: "UNAUTHORIZED" },
  ),
}));
vi.mock("@/infrastructure/http/same-origin-request", () => ({
  isSameOriginRequest: vi.fn(() => state.sameOrigin),
}));
vi.mock("@/infrastructure/rate-limit/postgres-rate-limiter", () => ({
  consume: vi.fn(),
}));
vi.mock("@/infrastructure/messaging/schedule-message-delivery", () => ({
  scheduleMessageDelivery: vi.fn(),
}));

let pool: Pool;
let preview: typeof import("@/app/admin/(protected)/events/[id]/importar/preview/route").POST;
let run: typeof import("@/app/admin/(protected)/events/[id]/importar/run/route").POST;

beforeAll(async () => {
  await resetTestDatabase();
  pool = (await import("@/infrastructure/db/client")).pool;
  preview = (await import("@/app/admin/(protected)/events/[id]/importar/preview/route")).POST;
  run = (await import("@/app/admin/(protected)/events/[id]/importar/run/route")).POST;
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name) VALUES ('route-import@example.com', 'route-import@example.com', 'hash', 'Admin') RETURNING id`,
  );
  state.adminId = admin.rows[0]!.id;
});

beforeEach(() => {
  state.authorized = true;
  state.sameOrigin = true;
  vi.mocked(Sentry.captureException).mockClear();
  vi.mocked(consume).mockReset().mockResolvedValue({
    allowed: true,
    remaining: 60,
    retryAfterSeconds: 0,
  });
  vi.mocked(scheduleMessageDelivery).mockClear();
});

afterAll(async () => {
  await pool?.end();
});

function request(
  text = "Nombre completo,Usuario de Instagram\nAna,@ANA",
  name = "responses.csv",
  fields: Record<string, string> = {},
  headers: HeadersInit = {},
) {
  const form = new FormData();
  form.set("file", new File([text], name));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("http://localhost:3000/admin/events/importar", {
    method: "POST",
    body: form,
    headers,
  });
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const mapping = JSON.stringify({ guest1Name: 0, guest1Instagram: 1 });

describe("admin guest import routes with PostgreSQL", () => {
  it.each(["preview", "run"])("protects %s with admin auth and origin checks", async (mode) => {
    const handler = mode === "preview" ? preview : run;
    state.authorized = false;
    expect((await handler(request(), context(randomUUID()))).status).toBe(401);
    state.authorized = true;
    state.sameOrigin = false;
    expect((await handler(request(), context(randomUUID()))).status).toBe(403);
  });

  it.each(["preview", "run"])(
    "checks size, extension, params and multipart fields for %s",
    async (mode) => {
      const handler = mode === "preview" ? preview : run;
      const id = randomUUID();
      expect(
        (
          await handler(
            request(
              "",
              "responses.csv",
              {},
              { "content-length": String(MAX_IMPORT_FILE_BYTES + 65_537) },
            ),
            context(id),
          )
        ).status,
      ).toBe(413);
      expect(
        (await handler(request("x".repeat(MAX_IMPORT_FILE_BYTES + 1)), context(id))).status,
      ).toBe(413);
      expect((await handler(request("text", "responses.xls"), context(id))).status).toBe(415);
      expect((await handler(request(), context("invalid"))).status).toBe(404);
      expect(
        (
          await handler(
            new Request("http://localhost", { method: "POST", body: "bad" }),
            context(id),
          )
        ).status,
      ).toBe(400);
      const empty = new Request("http://localhost", { method: "POST", body: new FormData() });
      const noFile = await handler(empty, context(id));
      expect(noFile.status).toBe(400);
      expect(await noFile.json()).toEqual({ error: "Selecciona un archivo." });
      expect(
        (await handler(request("a,b\nx,y", "responses.csv", { mapping: "bad" }), context(id)))
          .status,
      ).toBe(400);
      expect(
        (
          await handler(
            request("a,b\nx,y", "responses.csv", {
              mapping: '{"guest1Name":0,"guest1Instagram":0}',
            }),
            context(id),
          )
        ).status,
      ).toBe(400);
    },
  );

  it("returns 422 for malformed files, empty responses and excessive rows", async () => {
    const event = await insertTestEvent(pool);
    for (const [text, name] of [
      ["bad", "responses.xlsx"],
      ["{}", "responses.json"],
      ['"bad', "responses.csv"],
      ["Nombre,Instagram", "responses.csv"],
      ["Nombre,Instagram\n" + "Ana,ana\n".repeat(201), "responses.csv"],
    ]) {
      expect((await preview(request(text, name), context(event.id))).status).toBe(422);
      expect(
        (await run(request(text, name, { mapping, importId: randomUUID() }), context(event.id)))
          .status,
      ).toBe(422);
    }
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("reports an unexpected repository error before returning a generic 503", async () => {
    const event = await insertTestEvent(pool);
    const caught = new Error("Unexpected repository failure");
    const { PostgresReservationAllocationRepository } =
      await import("@/infrastructure/db/repositories/reservation-allocation-repository");
    const allocateImported = vi
      .spyOn(PostgresReservationAllocationRepository.prototype, "allocateImported")
      .mockRejectedValueOnce(caught);
    try {
      const response = await run(
        request(undefined, undefined, { mapping, importId: randomUUID() }),
        context(event.id),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "No se pudo completar la importación. Reintenta con el mismo identificador.",
      });
      expect(Sentry.captureException).toHaveBeenCalledExactlyOnceWith(caught);
    } finally {
      allocateImported.mockRestore();
    }
  });

  it.each(["DRAFT", "COMPLETED", "CANCELLED", "started"] as const)(
    "rejects %s events in preview and run",
    async (status) => {
      const event = await insertTestEvent(pool, {
        status: status === "started" ? "SCHEDULED" : status,
      });
      if (status === "started")
        await pool.query(
          "UPDATE events SET opens_at = clock_timestamp() - INTERVAL '3 hours', closes_at = clock_timestamp() - INTERVAL '2 hours', starts_at = clock_timestamp() - INTERVAL '1 hour' WHERE id = $1",
          [event.id],
        );
      for (const handler of [preview, run]) {
        const response = await handler(
          request(undefined, undefined, { mapping, importId: randomUUID() }),
          context(event.id),
        );
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
          error: "Solo puedes importar en experiencias publicadas que aún no empiezan.",
        });
      }
    },
  );

  it("returns 404 for missing and deleted events", async () => {
    const event = await insertTestEvent(pool);
    await pool.query("UPDATE events SET deleted_at = clock_timestamp() WHERE id = $1", [event.id]);
    for (const id of [event.id, randomUUID()]) {
      expect((await preview(request(), context(id))).status).toBe(404);
      expect(
        (await run(request(undefined, undefined, { mapping, importId: randomUUID() }), context(id)))
          .status,
      ).toBe(404);
    }
  });

  it("guesses Google Forms columns and reports capacity without saving rows", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 3,
      waitlistCapacity: 2,
      opensOffset: "1 hour",
      closesOffset: "2 hours",
    });
    const text =
      "Marca temporal,Nombre completo,Usuario de Instagram,Nombre de tu acompañante,Instagram de tu acompañante,¿Tienes alguna alergia?,Comentarios\n10/11/2026 8:00,Ana,@ANA,Luis,@LUIS,No,Hola";
    const response = await preview(request(text), context(event.id));
    expect(response.status).toBe(200);
    const body = (await response.json()) as ImportPreviewResponse;
    expect(body.mapping).toEqual({
      timestamp: 0,
      guest1Name: 1,
      guest1Instagram: 2,
      guest2Name: 3,
      guest2Instagram: 4,
      allergies: 5,
      notes: 6,
    });
    expect(body.rows[0]).toMatchObject({
      guests: [
        { name: expect.any(String), instagram: "ana" },
        { name: expect.any(String), instagram: "luis" },
      ],
      partySize: 2,
      allergies: null,
      order: 1,
    });
    expect(body.summary).toEqual({ valid: 1, invalid: 0, availableSeats: 3, waitlistAvailable: 2 });
    expect(
      (await pool.query("SELECT id FROM reservations WHERE event_id = $1", [event.id])).rowCount,
    ).toBe(0);
    const missing = await preview(request("One,Two\nAna,ana"), context(event.id));
    expect(missing.status).toBe(200);
    expect(((await missing.json()) as ImportPreviewResponse).rows[0]!.error).toBe(
      "Elige las columnas de nombre e Instagram.",
    );
    const explicit = await preview(
      request("One,Two\nAna,ana", "responses.csv", { mapping }),
      context(event.id),
    );
    expect(((await explicit.json()) as ImportPreviewResponse).summary.valid).toBe(1);
  });

  it("requires mapping and importId on run, revalidates the file and returns a replayable summary", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 2,
      maxPartySize: 1,
      waitlistCapacity: 1,
    });
    expect((await run(request(), context(event.id))).status).toBe(400);
    expect(
      (
        await run(
          request(undefined, undefined, { mapping, importId: "invalid" }),
          context(event.id),
        )
      ).status,
    ).toBe(400);
    const importId = randomUUID();
    const text = "Nombre,Instagram\nAna,ana\nLuis,luis\nEva,eva\nNoSeat,noseat\n,bad";
    const first = await run(
      request(text, "responses.CSV", { mapping, importId, rows: "untrusted client data" }),
      context(event.id),
    );
    expect(first.status).toBe(200);
    const body = (await first.json()) as ImportRunResponse;
    expect(body.summary).toEqual({ received: 2, waitlisted: 1, skipped: 2 });
    expect(body.outcomes.map((row) => row.result)).toEqual([
      "RECEIVED",
      "RECEIVED",
      "WAITLISTED",
      "EVENT_FULL",
      "INVALID",
    ]);
    expect(scheduleMessageDelivery).toHaveBeenCalledOnce();
    const second = await run(
      request(text, "responses.csv", { mapping, importId }),
      context(event.id),
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(body);
    expect(
      (await pool.query("SELECT id FROM messages WHERE event_id = $1", [event.id])).rowCount,
    ).toBe(3);
  });

  it.each([
    ["preview", 60],
    ["run", 20],
  ] as const)("rate limits %s by admin", async (mode, limit) => {
    vi.mocked(consume).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 600,
    });
    expect(
      (await (mode === "preview" ? preview : run)(request(), context(randomUUID()))).status,
    ).toBe(429);
    expect(consume).toHaveBeenCalledExactlyOnceWith({
      scope: `admin-import:${mode}`,
      subject: state.adminId,
      limit,
      windowSeconds: 600,
    });
  });
});
