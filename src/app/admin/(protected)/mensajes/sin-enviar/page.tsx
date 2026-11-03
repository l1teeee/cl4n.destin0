import Link from "next/link";

import {
  discardMessageAction,
  markSentManuallyAction,
} from "@/app/admin/(protected)/mensajes/actions";
import { listUnsentMessages } from "@/application/messaging/messaging-health";
import { hasPermission } from "@/domain/admin/admin-access";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";
import { loadMessagingHealth } from "@/infrastructure/messaging/load-messaging-health";
import { MessagingHealthBanner } from "@/ui/admin/messages/messaging-health-banner";
import { messagingHealthView, unsentMessageView } from "@/ui/admin/messages/messaging-health-view";
import { UnsentMessageList } from "@/ui/admin/messages/unsent-message-list";
import { Button } from "@/ui/primitives/button";

const UNSENT_LIMIT = 100;

export default async function UnsentMessagesPage() {
  const authorization = await requireAdmin("page");
  const canSend = hasPermission(authorization.session.admin.role, "messages.send");
  const [health, messages] = await Promise.all([
    loadMessagingHealth(),
    listUnsentMessages(postgresMessageRepository, UNSENT_LIMIT),
  ]);

  return (
    <main className="admin-page max-w-3xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="admin-eyebrow">Mensajes</p>
          <h1 className="admin-title">Sin enviar</h1>
          <p className="admin-description">
            Mensajes que Instagram no entregó o que esperan a que la persona escriba. Enviar por
            Instagram copia el texto y abre el chat: pégalo, envíalo y marca Ya lo envié.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/admin/mensajes">Volver a mensajes</Link>
        </Button>
      </div>
      <MessagingHealthBanner view={messagingHealthView(health)} showUnsentLink={false} />
      {!canSend ? (
        <p className="admin-muted">
          Solo lectura: solo un superadministrador puede enviar mensajes.
        </p>
      ) : null}
      <UnsentMessageList
        items={messages.map(unsentMessageView)}
        canAct={canSend}
        markSentAction={markSentManuallyAction}
        discardAction={discardMessageAction}
      />
      {messages.length === UNSENT_LIMIT ? (
        <p className="admin-muted text-xs">Se muestran los 100 más antiguos.</p>
      ) : null}
    </main>
  );
}
