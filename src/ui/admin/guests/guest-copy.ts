export type MessageOutcome =
  "SENT" | "QUEUED" | "WAITING_CONTACT" | "WAITING_WINDOW" | "FAILED" | "NOT_SENT";

export type AddedPlacement = "LIST" | "QUEUE";

const outcomeSentences: Record<MessageOutcome, string> = {
  SENT: "Mensaje enviado por Instagram.",
  QUEUED: "El mensaje se está enviando.",
  WAITING_CONTACT: "El mensaje quedó pendiente: todavía no nos ha escrito por Instagram.",
  WAITING_WINDOW: "El mensaje quedó pendiente: se enviará cuando vuelva a escribir por Instagram.",
  FAILED: "No se pudo enviar el mensaje; puedes reintentarlo desde Mensajes.",
  NOT_SENT: "",
};

interface ConfirmationInput {
  guests: readonly string[];
  replacements: readonly string[];
}

interface MessageResultInput {
  guests: readonly string[];
  outcome: MessageOutcome;
}

interface PromotingResultInput extends MessageResultInput {
  promoted: readonly string[];
}

interface CancelledResultInput extends PromotingResultInput {
  refundPending: boolean;
}

interface AddedResultInput {
  guests: readonly string[];
  placement: AddedPlacement;
  position?: number | null;
}

function isCouple(guests: readonly string[]): boolean {
  return guests.length > 1;
}

export function guestsLabel(names: readonly string[]): string {
  return names.join(" y ");
}

export function partySizeLabel(count: number): string {
  return count === 1 ? "1 persona" : `${count} personas`;
}

export function replacementSentence(replacements: readonly string[]): string {
  if (replacements.length === 0) {
    return "No hay nadie en la cola, así que el lugar quedará libre.";
  }

  const names = replacements.join(" y a ");
  if (replacements.length === 1) {
    return `Se va a agregar a ${names}, que es la primera en la cola.`;
  }
  return `Se van a agregar a ${names}, que son los primeros en la cola.`;
}

export function rejectConfirmation({ guests, replacements }: ConfirmationInput): string {
  return `Al rechazar a ${guestsLabel(guests)} va a quedar un espacio vacío. ${replacementSentence(replacements)} ¿Estás seguro?`;
}

export function cancelUnpaidConfirmation({ guests, replacements }: ConfirmationInput): string {
  return `Al eliminar a ${guestsLabel(guests)} de la lista va a quedar un espacio vacío. ${replacementSentence(replacements)} ¿Estás seguro?`;
}

export function cancelPaidConfirmation({ guests, replacements }: ConfirmationInput): string {
  const paid = isCouple(guests) ? "pagaron" : "pagó";
  const newcomerNote =
    replacements.length === 0
      ? ""
      : " Quien entre tendrá que pasar por todo el proceso: revisión, lista y pago.";

  return `${guestsLabel(guests)} ya ${paid}. Se le enviará un mensaje lamentando la cancelación y quedará pendiente el reembolso. Va a quedar un espacio vacío. ${replacementSentence(replacements)}${newcomerNote} ¿Estás seguro?`;
}

export function messageOutcomeSentence(outcome: MessageOutcome): string {
  return outcomeSentences[outcome];
}

function withOutcome(text: string, outcome: MessageOutcome): string {
  const outcomeSentence = messageOutcomeSentence(outcome);
  return outcomeSentence === "" ? text : `${text} ${outcomeSentence}`;
}

function promotedSentence(promoted: readonly string[]): string {
  if (promoted.length === 0) return "";
  return ` Se agregó a ${promoted.join(" y a ")} a la lista para revisión.`;
}

export function acceptedResult({ guests, outcome }: MessageResultInput): string {
  const verb = isCouple(guests) ? "están" : "está";
  return withOutcome(`Aceptaste a ${guestsLabel(guests)}. Ya ${verb} en la lista.`, outcome);
}

export function paymentVerifiedResult({ guests, outcome }: MessageResultInput): string {
  const couple = isCouple(guests);
  const verb = couple ? "quedaron" : "quedó";
  const confirmed = couple ? "confirmados" : "confirmado";
  return withOutcome(`Pago verificado: ${guestsLabel(guests)} ${verb} ${confirmed}.`, outcome);
}

export function rejectedResult({ guests, promoted, outcome }: PromotingResultInput): string {
  return withOutcome(`Se rechazó a ${guestsLabel(guests)}.${promotedSentence(promoted)}`, outcome);
}

export function cancelledResult({
  guests,
  promoted,
  refundPending,
  outcome,
}: CancelledResultInput): string {
  const refund = refundPending ? " Reembolso pendiente." : "";
  const text = `Se canceló a ${guestsLabel(guests)} correctamente.${promotedSentence(promoted)}${refund}`;
  return withOutcome(text, outcome);
}

export function refundedResult({ guests, outcome }: MessageResultInput): string {
  return withOutcome(`Reembolso registrado para ${guestsLabel(guests)}.`, outcome);
}

export function promotedFromQueueResult({ guests, outcome }: MessageResultInput): string {
  const verb = isCouple(guests) ? "pasaron" : "pasó";
  return withOutcome(
    `${guestsLabel(guests)} ${verb} de la cola a la lista para revisión.`,
    outcome,
  );
}

export function removedFromQueueResult({ guests, outcome }: MessageResultInput): string {
  return withOutcome(`Se quitó a ${guestsLabel(guests)} de la cola.`, outcome);
}

export function addedResult({ guests, placement, position }: AddedResultInput): string {
  const label = guestsLabel(guests);
  if (placement === "LIST") return `Se agregó a ${label} a la lista para revisión.`;

  if (position === undefined || position === null) {
    throw new Error("A guest placed in the queue needs its queue position.");
  }
  const verb = isCouple(guests) ? "quedaron" : "quedó";
  return `No había lugar: ${label} ${verb} en la cola en la posición ${position}.`;
}
