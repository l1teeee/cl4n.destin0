import { countUnreadConversations } from "@/application/messaging/conversation-queries";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const authorization = await requireAdmin("route");
  if (!authorization.authorized) return new Response(null, { status: 401 });

  const count = await countUnreadConversations(postgresMessageRepository);
  return Response.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
