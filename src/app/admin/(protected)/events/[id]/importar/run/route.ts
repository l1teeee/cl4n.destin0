import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import {
  columnMappingSchema,
  IMPORT_FILE_EXTENSIONS,
  MAX_IMPORT_FILE_BYTES,
  type ImportRunResponse,
} from "@/contracts/guest-import";
import { buildImportRows, ImportTableError } from "@/domain/guest-import/import-rows";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { isSameOriginRequest } from "@/infrastructure/http/same-origin-request";
import { readImportFile } from "@/infrastructure/import/read-import-file";
import { consume } from "@/infrastructure/rate-limit/postgres-rate-limiter";
import { createImportReservations } from "@/application/reservations/import-reservations";
import { generateLinkCode } from "@/infrastructure/crypto/link-code-generator";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";
import { importRowFingerprint, importRowKey } from "@/infrastructure/import/import-keys";
import { scheduleMessageDelivery } from "@/infrastructure/messaging/schedule-message-delivery";

const paramsSchema = z.object({ id: z.uuid() });

export const maxDuration = 300;

const importReservations = createImportReservations({
  repository: new PostgresReservationAllocationRepository(),
  generateLinkCode,
  rowKey: importRowKey,
  rowFingerprint: importRowFingerprint,
});

function error(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorization = await requireAdmin("route");
  if (!authorization.authorized) return error("No autorizado.", 401);
  if (!isSameOriginRequest(request)) return error("Origen no permitido.", 403);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_FILE_BYTES + 65_536) {
    return error("El archivo supera 1 MB.", 413);
  }
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return error("No se encontró la experiencia.", 404);
  const limit = await consume({
    scope: "admin-import:run",
    subject: authorization.session.admin.id,
    limit: 20,
    windowSeconds: 600,
  });
  if (!limit.allowed) return error("Demasiados intentos. Vuelve a intentarlo más tarde.", 429);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return error("No se pudo leer el archivo.", 400);
  }
  const file = formData.get("file");
  if (!(file instanceof File)) return error("Selecciona un archivo.", 400);
  if (file.size > MAX_IMPORT_FILE_BYTES) return error("El archivo supera 1 MB.", 413);
  if (!IMPORT_FILE_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))) {
    return error("Usa un archivo CSV, Excel (.xlsx) o JSON.", 415);
  }
  let mapping;
  const mappingValue = formData.get("mapping");
  if (mappingValue !== null) {
    try {
      if (typeof mappingValue !== "string") return error("El mapeo de columnas no es válido.", 400);
      const parsed = columnMappingSchema.safeParse(JSON.parse(mappingValue));
      if (!parsed.success) return error("El mapeo de columnas no es válido.", 400);
      mapping = parsed.data;
    } catch {
      return error("El mapeo de columnas no es válido.", 400);
    }
  }
  if (!mapping) return error("El mapeo de columnas no es válido.", 400);
  const importId = z.uuid().safeParse(formData.get("importId"));
  if (!importId.success) return error("El identificador de importación no es válido.", 400);

  const timed = await postgresEventRepository.getAdminEvent(parsedParams.data.id);
  const event = timed.value;
  if (!event) return error("No se encontró la experiencia.", 404);
  if (
    (event.status !== "SCHEDULED" && event.status !== "CLOSED") ||
    event.startsAt <= timed.databaseTime
  ) {
    return error("Solo puedes importar en experiencias publicadas que aún no empiezan.", 409);
  }
  try {
    const table = await readImportFile(file.name, new Uint8Array(await file.arrayBuffer()));
    const rows = buildImportRows(table, mapping, event.maxPartySize);
    const outcomes = await importReservations({
      eventId: event.id,
      adminId: authorization.session.admin.id,
      importId: importId.data,
      rows,
    });
    const received = outcomes.filter((row) => row.result === "RECEIVED").length;
    const waitlisted = outcomes.filter((row) => row.result === "WAITLISTED").length;
    if (received + waitlisted > 0) scheduleMessageDelivery();
    const response: ImportRunResponse = {
      importId: importId.data,
      outcomes,
      summary: { received, waitlisted, skipped: outcomes.length - received - waitlisted },
    };
    return Response.json(response);
  } catch (caught) {
    if (caught instanceof ImportTableError) return error(caught.message, 422);
    Sentry.captureException(caught);
    return error("No se pudo completar la importación. Reintenta con el mismo identificador.", 503);
  }
}
