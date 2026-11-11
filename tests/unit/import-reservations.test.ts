import { describe, expect, it, vi } from "vitest";

import type {
  AllocationResult,
  ImportAllocationCommand,
  ReservationAllocationRepository,
} from "@/application/ports/reservation-allocation-repository";
import { createImportReservations } from "@/application/reservations/import-reservations";
import type { ImportPreviewRow } from "@/contracts/guest-import";
import { buildImportRows } from "@/domain/guest-import/import-rows";

function setup(bodies: Record<string, unknown>[] = [{ code: "RECEIVED", number: 7 }]) {
  let next = 0;
  const allocateImported = vi.fn(async (): Promise<AllocationResult> => ({
    status: 200,
    body: bodies[Math.min(next++, bodies.length - 1)]!,
    replayed: true,
  }));
  const repository: ReservationAllocationRepository = {
    allocateImported,
    async allocate() {
      throw new Error("public allocation should not run");
    },
    async findCompletedIdempotencyRecord() {
      return null;
    },
    async cancelReservation() {
      return "NOT_FOUND";
    },
    async cancelWaitlistEntry() {
      return "NOT_FOUND";
    },
  };
  const generateLinkCode = vi.fn(() => `CODE${next}`);
  const importReservations = createImportReservations({
    repository,
    generateLinkCode,
    rowKey: (id, number) => `${id}:${number}`,
    rowFingerprint: (eventId, row) => `${eventId}:${row.guests[0]!.instagram}`,
  });
  return { importReservations, allocateImported, generateLinkCode };
}

function rows(): ImportPreviewRow[] {
  return buildImportRows(
    {
      headers: ["Nombre", "Instagram"],
      rows: [
        ["Ana", "ana"],
        ["Luis", "luis"],
        ["", "invalid"],
      ],
    },
    { guest1Name: 0, guest1Instagram: 1 },
    100,
  );
}

const input = { eventId: "event", adminId: "admin", importId: "import" };

describe("importReservations", () => {
  it("allocates valid rows sequentially by order and returns outcomes in file order", async () => {
    const setupResult = setup([
      { code: "WAITLISTED", position: 3 },
      { code: "RECEIVED", number: 8 },
    ]);
    const data = rows();
    data[0]!.order = 2;
    data[1]!.order = 1;
    const outcomes = await setupResult.importReservations({ ...input, rows: data });
    expect(outcomes).toEqual([
      { rowNumber: 2, result: "RECEIVED", reservationNumber: 8, message: "En Por revisar." },
      {
        rowNumber: 3,
        result: "WAITLISTED",
        waitlistPosition: 3,
        message: "En la cola, posición 3.",
      },
      { rowNumber: 4, result: "INVALID", message: "El nombre completo es obligatorio." },
    ]);
    const commands = setupResult.allocateImported.mock.calls as unknown as [
      ImportAllocationCommand,
    ][];
    expect(commands.map(([command]) => command.rowNumber)).toEqual([3, 2]);
    expect(commands[0]![0]).toMatchObject({
      ...input,
      idempotencyKey: "import:3",
      fingerprint: "event:luis",
      guests: [{ name: "Luis", instagram: "luis" }],
    });
    const mapOutcome = commands[0]![0].mapOutcome;
    expect(
      mapOutcome({
        code: "RECEIVED",
        number: 1,
        partySize: 1,
        eventStartsAt: new Date(),
        linkCode: "CODE",
      }),
    ).toEqual({ status: 200, body: { code: "RECEIVED", number: 1 } });
    expect(
      mapOutcome({
        code: "WAITLISTED",
        position: 2,
        partySize: 1,
        eventStartsAt: new Date(),
        linkCode: "CODE",
      }),
    ).toEqual({ status: 200, body: { code: "WAITLISTED", position: 2 } });
    expect(mapOutcome({ code: "EVENT_FULL" })).toEqual({
      status: 200,
      body: { code: "EVENT_FULL" },
    });
  });

  it("retries the same row and key with new link codes", async () => {
    const result = setup([
      { code: "TRY_AGAIN" },
      { code: "TRY_AGAIN" },
      { code: "RECEIVED", number: 1 },
    ]);
    expect(
      (await result.importReservations({ ...input, rows: rows().slice(0, 1) }))[0]!.result,
    ).toBe("RECEIVED");
    expect(result.allocateImported).toHaveBeenCalledTimes(3);
    const commands = result.allocateImported.mock.calls as unknown as [ImportAllocationCommand][];
    expect(commands.map(([command]) => command.idempotencyKey)).toEqual([
      "import:2",
      "import:2",
      "import:2",
    ]);
    expect(new Set(commands.map(([command]) => command.linkCode)).size).toBe(3);
  });

  it("throws after three transient failures so the route can return 503", async () => {
    const result = setup([{ code: "TRY_AGAIN" }]);
    await expect(result.importReservations({ ...input, rows: rows() })).rejects.toThrow(
      "retries exhausted",
    );
    expect(result.allocateImported).toHaveBeenCalledTimes(3);
  });

  it.each(["EVENT_NOT_OPEN", "EVENT_NOT_FOUND"])(
    "stops remaining valid rows after %s",
    async (code) => {
      const result = setup([{ code }]);
      const outcomes = await result.importReservations({ ...input, rows: rows() });
      expect(outcomes.map((row) => row.result)).toEqual([
        "EVENT_NOT_OPEN",
        "NOT_PROCESSED",
        "INVALID",
      ]);
      expect(outcomes[0]!.message).toBe("La experiencia ya no acepta importaciones.");
      expect(outcomes[1]!.message).toBe("No se procesó.");
      expect(result.allocateImported).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["DUPLICATE_RESERVATION", "DUPLICATE", "Ya tiene una solicitud activa en esta experiencia."],
    ["EVENT_FULL", "EVENT_FULL", "Sin lugares ni espacio en la cola."],
    [
      "PARTY_SIZE_NOT_ALLOWED",
      "PARTY_SIZE_NOT_ALLOWED",
      "Esta experiencia solo acepta solicitudes individuales.",
    ],
    [
      "IDEMPOTENCY_KEY_REUSED",
      "CHANGED",
      "La fila cambió desde el primer intento. Vuelve a leer el archivo.",
    ],
  ])("maps stored replay %s", async (code, expected, message) => {
    const result = setup([{ code }]);
    expect(await result.importReservations({ ...input, rows: rows().slice(0, 1) })).toEqual([
      { rowNumber: 2, result: expected, message },
    ]);
  });
});
