import { z } from "zod";

import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";

const idSchema = z.uuid();

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorization = await requireAdmin("route");
  if (!authorization.authorized) return new Response(null, { status: 401 });
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return new Response(null, { status: 404 });
  const attachment = await postgresMessageRepository.getAttachment(id.data);
  if (!attachment) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(attachment.data), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": attachment.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
