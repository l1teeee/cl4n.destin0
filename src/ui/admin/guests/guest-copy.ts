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
  waitingCount: number;
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

export function replacementSentence(
  replacements: readonly string[],
  waitingCount: number,
  freedSeats: number,
): string {
  if (replacements.length === 0) {
    const reason =
      waitingCount === 0 ? "No hay nadie en la cola" : "La primera solicitud de la cola no cabe";
    const place = freedSeats === 1 ? "el lugar quedará libre" : "los lugares quedarán libres";
    return `${reason}, así que ${place}.`;
  }

  const names = replacements.join(" y de ");
  if (replacements.length === 1) {
    return `Se va a agregar desde la cola la solicitud de ${names}.`;
  }
  return `Se van a agregar desde la cola las solicitudes de ${names}.`;
}

export function rejectConfirmation({
  guests,
  replacements,
  waitingCount,
}: ConfirmationInput): string {
  const seats = isCouple(guests)
    ? "van a quedar dos espacios vacíos"
    : "va a quedar un espacio vacío";
  return `Al rechazar a ${guestsLabel(guests)} ${seats}. ${replacementSentence(replacements, waitingCount, guests.length)} ¿Estás seguro?`;
}

export function cancelUnpaidConfirmation({
  guests,
  replacements,
  waitingCount,
}: ConfirmationInput): string {
  const seats = isCouple(guests)
    ? "van a quedar dos espacios vacíos"
    : "va a quedar un espacio vacío";
  return `Al eliminar a ${guestsLabel(guests)} de la lista ${seats}. ${replacementSentence(replacements, waitingCount, guests.length)} ¿Estás seguro?`;
}

export function cancelPaidConfirmation({
  guests,
  replacements,
  waitingCount,
}: ConfirmationInput): string {
  const paid = isCouple(guests) ? "pagaron" : "pagó";
  const seats = isCouple(guests)
    ? "Van a quedar dos espacios vacíos"
    : "Va a quedar un espacio vacío";
  const newcomerNote =
    replacements.length === 0
      ? ""
      : " Quien entre tendrá que pasar por todo el proceso: revisión, lista y pago.";

  return `${guestsLabel(guests)} ya ${paid}. Se le enviará un mensaje lamentando la cancelación y quedará pendiente el reembolso. ${seats}. ${replacementSentence(replacements, waitingCount, guests.length)}${newcomerNote} ¿Estás seguro?`;
}

export const acceptConfirmation =
  "Se le enviará por Instagram que está en la lista, con 48 horas para pagar.";

export function verifyPaymentConfirmation(guests: readonly string[]): string {
  const couple = isCouple(guests);
  const paid = couple ? "pagaron" : "pagó";
  const confirmed = couple ? "Quedarán confirmados" : "Quedará confirmado";
  return `Confirma que ${guestsLabel(guests)} ya ${paid}. ${confirmed} y se le enviará un mensaje por Instagram.`;
}

export function removeFromQueueConfirmation(guests: readonly string[]): string {
  return `Se quitará a ${guestsLabel(guests)} de la cola. ¿Estás seguro?`;
}

export function refundConfirmation(guests: readonly string[]): string {
  return `Confirma que ya le devolviste el pago a ${guestsLabel(guests)}.`;
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

// Edit, move and remove promote from the queue as a side effect that no confirmation dialog
// showed beforehand, so their result has to say who came in.
export function enteredFromQueueSentence(promoted: readonly string[]): string {
  if (promoted.length === 0) return "";
  return ` Entró ${promoted.join(" y ")} desde la cola.`;
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

export function removedFromQueueResult({
  guests,
  promoted,
  outcome,
}: PromotingResultInput): string {
  const text = `Se quitó a ${guestsLabel(guests)} de la cola.${enteredFromQueueSentence(promoted)}`;
  return withOutcome(text, outcome);
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
