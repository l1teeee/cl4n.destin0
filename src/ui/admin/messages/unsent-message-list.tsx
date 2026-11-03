import Link from "next/link";

import { MutationForm } from "@/ui/admin/mutation-form";
import { cn } from "@/ui/cn";
import { Badge } from "@/ui/primitives/badge";

import { ManualSendButton } from "./manual-send-buttons";
import type { MessageAction } from "./message-copy";
import { pillMutationButtons } from "./message-group";
import type { UnsentMessageView } from "./messaging-health-view";

interface UnsentMessageListProps {
  items: readonly UnsentMessageView[];
  canAct: boolean;
  markSentAction: MessageAction;
  discardAction: MessageAction;
}

export function UnsentMessageList({
  items,
  canAct,
  markSentAction,
  discardAction,
}: UnsentMessageListProps) {
  if (items.length === 0) {
    return <p className="admin-empty text-sm">No hay mensajes pendientes.</p>;
  }

  return (
    <ul className="grid gap-3">
      {items.map((item) => {
        const handleLabel = item.username ? `@${item.username}` : "Sin usuario de Instagram";
        const subtitle = item.eventLabel ? `${handleLabel} · ${item.eventLabel}` : handleLabel;

        return (
          <li key={item.id} className="grid gap-3 rounded-2xl border border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={item.statusVariant}>{item.statusLabel}</Badge>
              <span className="text-xs text-[#8d8b85]">{item.kindLabel}</span>
              <span className="text-xs text-[#8d8b85]">{item.createdLabel}</span>
            </div>
            <div>
              <p className="text-sm font-medium text-[#fffbf4]">{item.guestLabel}</p>
              <p className="admin-muted text-xs">{subtitle}</p>
            </div>
            {item.body !== null ? (
              <p className="whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-sm text-[#fffbf4]">
                {item.body}
              </p>
            ) : null}
            {item.attachmentNote ? (
              <p className="text-xs text-[#8d8b85]">{item.attachmentNote}</p>
            ) : null}
            {item.errorLabel ? <p className="text-xs text-destructive">{item.errorLabel}</p> : null}
            {canAct ? (
              <div className={cn("flex flex-wrap items-start gap-2", pillMutationButtons)}>
                <ManualSendButton username={item.username} text={item.body} />
                <MutationForm action={markSentAction.bind(null, item.id)} label="Ya lo envié" />
                {item.canDiscard ? (
                  <MutationForm
                    action={discardAction.bind(null, item.id)}
                    label="Descartar"
                    confirmation="El mensaje no se enviará a la persona. Confirma para continuar."
                    danger
                  />
                ) : null}
              </div>
            ) : null}
            {item.conversationHref ? (
              <Link href={item.conversationHref} className="text-sm underline underline-offset-4">
                Ver conversación
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
