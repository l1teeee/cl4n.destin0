import { z } from "zod";

import { detectImageContentType } from "@/contracts/image-upload";
import { eventClueSchema } from "@/contracts/event-clue";
import type { StoredEventClueImage } from "@/application/events/event-clue-repository";
import { publishEventClue } from "@/application/events/event-clues";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventClueRepository } from "@/infrastructure/db/repositories/postgres-event-clue-repository";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { isSameOriginRequest } from "@/infrastructure/http/same-origin-request";

const paramsSchema = z.object({ id: z.string().uuid() });
const maxImageBytes = 1_048_576;
const maxImages = 3;
const maxRequestBytes = 4_194_304;

function error(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

async function readBoundedBody(request: Request): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxRequestBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorization = await requireAdmin("route");
  if (!authorization.authorized) return error("No autorizado.", 401);
  if (!isSameOriginRequest(request)) return error("Origen no permitido.", 403);

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    return error("La solicitud es demasiado grande.", 413);
  }

  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return error("No se encontró la experiencia.", 404);

  const body = await readBoundedBody(request);
  if (!body) return error("La solicitud es demasiado grande.", 413);

  let formData: FormData;
  try {
    const bufferedRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: Uint8Array.from(body).buffer as ArrayBuffer,
    });
    formData = await bufferedRequest.formData();
  } catch {
    return error("No se pudo leer la solicitud.", 400);
  }

  const parsedBody = eventClueSchema.safeParse({ body: formData.get("body") });
  if (!parsedBody.success)
    return error(parsedBody.error.issues[0]?.message ?? "Pista inválida.", 400);

  const files = formData.getAll("images");
  if (files.length > maxImages) return error("Puedes adjuntar hasta 3 imágenes.", 400);
  const images: StoredEventClueImage[] = [];
  let totalImageBytes = 0;
  for (const file of files) {
    if (!(file instanceof File)) return error("El archivo no es válido.", 400);
    if (file.size < 1 || file.size > maxImageBytes) {
      return error("Cada imagen debe pesar hasta 1 MB.", 413);
    }
    totalImageBytes += file.size;
    const data = Buffer.from(await file.arrayBuffer());
    const contentType = detectImageContentType(data);
    if (!contentType) return error("Las imágenes deben ser JPG, PNG o WebP.", 415);
    images.push({ data, contentType });
  }
  if (totalImageBytes > maxImages * maxImageBytes) {
    return error("El peso total de las imágenes es demasiado grande.", 413);
  }

  const result = await publishEventClue(postgresEventRepository, postgresEventClueRepository, {
    eventId: parsedParams.data.id,
    body: parsedBody.data.body,
    images,
    actorId: authorization.session.admin.id,
  });
  if (!result.ok) {
    return error(
      result.error === "EVENT_NOT_FOUND"
        ? "No se encontró la experiencia."
        : "Las pistas solo se pueden publicar mientras la experiencia está cerrada.",
      result.error === "EVENT_NOT_FOUND" ? 404 : 409,
    );
  }
  return Response.json({ id: result.value.id }, { status: 201 });
}
