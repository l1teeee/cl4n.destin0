import type { MessageStatus } from "@/domain/messaging/message-types";

interface OutcomeCounts {
  sent: number;
  waitingWindow: number;
  waitingContact: number;
  queued: number;
  failed: number;
  discarded: number;
}

function countOutcomes(
  messageIds: readonly string[],
  outcomes: Readonly<Record<string, MessageStatus>>,
): OutcomeCounts {
  const counts: OutcomeCounts = {
    sent: 0,
    waitingWindow: 0,
    waitingContact: 0,
    queued: 0,
    failed: 0,
    discarded: 0,
  };
  for (const id of messageIds) {
    switch (outcomes[id]) {
      case "SENT":
      case "READ":
      case "SENT_MANUALLY":
        counts.sent += 1;
        break;
      case "WAITING_WINDOW":
        counts.waitingWindow += 1;
        break;
      case "WAITING_CONTACT":
        counts.waitingContact += 1;
        break;
      case "QUEUED":
        counts.queued += 1;
        break;
      case "FAILED":
        counts.failed += 1;
        break;
      case "DISCARDED":
        counts.discarded += 1;
        break;
    }
  }
  return counts;
}

function people(count: number): string {
  return count === 1 ? "1 persona" : `${count} personas`;
}

/**
 * stillPending counts the guests whose message for the current revision was queued earlier and has
 * not been delivered yet; it only matters when this send had nobody new to reach.
 */
export function describeLocationSend(
  messageIds: readonly string[],
  outcomes: Readonly<Record<string, MessageStatus>>,
  stillPending = 0,
): string {
  if (messageIds.length === 0) {
    return stillPending === 0
      ? "Todas las personas confirmadas ya tienen la ubicación actual."
      : `Nadie más necesita el envío. ${people(stillPending)} ${
          stillPending === 1 ? "sigue pendiente" : "siguen pendientes"
        } de recibir la ubicación; revísalo en Mensajes.`;
  }

  const counts = countOutcomes(messageIds, outcomes);
  const sentences = [
    counts.sent > 0
      ? `Ubicación enviada a ${people(counts.sent)}.`
      : "Todavía nadie recibió la ubicación.",
  ];

  if (counts.waitingWindow === 1) {
    sentences.push("1 quedó pendiente porque no nos ha escrito en las últimas 24 horas.");
  } else if (counts.waitingWindow > 1) {
    sentences.push(
      `${counts.waitingWindow} quedaron pendientes porque no nos han escrito en las últimas 24 horas.`,
    );
  }

  if (counts.waitingContact === 1) {
    sentences.push("1 quedó pendiente porque aún no vinculamos su conversación de Instagram.");
  } else if (counts.waitingContact > 1) {
    sentences.push(
      `${counts.waitingContact} quedaron pendientes porque aún no vinculamos su conversación de Instagram.`,
    );
  }

  if (counts.queued === 1) {
    sentences.push("1 se enviará en unos minutos.");
  } else if (counts.queued > 1) {
    sentences.push(`${counts.queued} se enviarán en unos minutos.`);
  }

  if (counts.failed === 1) {
    sentences.push("1 no se pudo enviar; revísalo en Mensajes.");
  } else if (counts.failed > 1) {
    sentences.push(`${counts.failed} no se pudieron enviar; revísalos en Mensajes.`);
  }

  if (counts.discarded === 1) {
    sentences.push("1 se descartó porque ya no corresponde.");
  } else if (counts.discarded > 1) {
    sentences.push(`${counts.discarded} se descartaron porque ya no corresponden.`);
  }

  return sentences.join(" ");
}
