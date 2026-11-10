import type {
  AllocationOutcome,
  ReservationAllocationRepository,
  ReservationResponse,
} from "@/application/ports/reservation-allocation-repository";
import type { ImportPreviewRow, ImportRowOutcome } from "@/contracts/guest-import";

function mapOutcome(outcome: AllocationOutcome): ReservationResponse {
  return {
    status: 200,
    body: {
      code: outcome.code,
      ...(outcome.code === "RECEIVED" ? { number: outcome.number } : {}),
      ...(outcome.code === "WAITLISTED" ? { position: outcome.position } : {}),
    },
  };
}

function rowOutcome(rowNumber: number, body: Record<string, unknown>): ImportRowOutcome {
  switch (body.code) {
    case "RECEIVED":
      return {
        rowNumber,
        result: "RECEIVED",
        reservationNumber: body.number as number,
        message: "En Por revisar.",
      };
    case "WAITLISTED":
      return {
        rowNumber,
        result: "WAITLISTED",
        waitlistPosition: body.position as number,
        message: `En la cola, posición ${body.position}.`,
      };
    case "DUPLICATE_RESERVATION":
      return {
        rowNumber,
        result: "DUPLICATE",
        message: "Ya tiene una solicitud activa en esta experiencia.",
      };
    case "EVENT_FULL":
      return { rowNumber, result: "EVENT_FULL", message: "Sin lugares ni espacio en la cola." };
    case "PARTY_SIZE_NOT_ALLOWED":
      return {
        rowNumber,
        result: "PARTY_SIZE_NOT_ALLOWED",
        message: "Esta experiencia solo acepta solicitudes individuales.",
      };
    case "IDEMPOTENCY_KEY_REUSED":
      return {
        rowNumber,
        result: "CHANGED",
        message: "La fila cambió desde el primer intento. Vuelve a leer el archivo.",
      };
    case "EVENT_NOT_OPEN":
    case "EVENT_NOT_FOUND":
      return {
        rowNumber,
        result: "EVENT_NOT_OPEN",
        message: "La experiencia ya no acepta importaciones.",
      };
    default:
      throw new Error("Unexpected import allocation outcome");
  }
}

export function createImportReservations(deps: {
  repository: ReservationAllocationRepository;
  generateLinkCode(): string;
  rowKey(importId: string, rowNumber: number): string;
  rowFingerprint(eventId: string, row: ImportPreviewRow): string;
}) {
  return async function importReservations(input: {
    eventId: string;
    adminId: string;
    importId: string;
    rows: ImportPreviewRow[];
  }): Promise<ImportRowOutcome[]> {
    const outcomes = new Map<number, ImportRowOutcome>();
    for (const row of input.rows) {
      if (row.error)
        outcomes.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          result: "INVALID",
          message: row.error,
        });
    }
    const valid = input.rows.filter((row) => !row.error).sort((a, b) => a.order! - b.order!);
    let stopped = false;
    for (const row of valid) {
      if (stopped) {
        outcomes.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          result: "NOT_PROCESSED",
          message: "No se procesó.",
        });
        continue;
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const allocation = await deps.repository.allocateImported({
          eventId: input.eventId,
          adminId: input.adminId,
          importId: input.importId,
          rowNumber: row.rowNumber,
          idempotencyKey: deps.rowKey(input.importId, row.rowNumber),
          fingerprint: deps.rowFingerprint(input.eventId, row),
          fullName: row.guest1Name,
          instagramHandle: row.guest1Instagram,
          guest2FullName: row.guest2Name,
          guest2InstagramHandle: row.guest2Instagram,
          partySize: row.partySize,
          notes: row.notes ?? undefined,
          allergies: row.allergies,
          linkCode: deps.generateLinkCode(),
          mapOutcome,
        });
        if (allocation.body.code === "TRY_AGAIN") {
          if (attempt === 2) throw new Error("Import allocation retries exhausted");
          continue;
        }
        const outcome = rowOutcome(row.rowNumber, allocation.body);
        outcomes.set(row.rowNumber, outcome);
        stopped = outcome.result === "EVENT_NOT_OPEN";
        break;
      }
    }
    return input.rows.map((row) => outcomes.get(row.rowNumber)!);
  };
}
