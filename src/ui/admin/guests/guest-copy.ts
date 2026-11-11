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
  // The guests of each queue entry the automatic promotion would take.
  replacements: readonly (readonly string[])[];
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
  if (names.length <= 2) return names.join(" y ");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

export function partySizeLabel(count: number): string {
  if (count === 1) return "Individual";
  if (count === 2) return "Pareja";
  return `Grupo de ${count}`;
}

function seatsOpenSentence(seats: number): string {
  return seats === 1 ? "Va a dejar un cupo abierto." : `Va a dejar ${seats} cupos abiertos.`;
}

function leavesListSentence(guests: readonly string[]): string {
  const verb = isCouple(guests) ? "salen" : "sale";
  return `${guestsLabel(guests)} ${verb} de la lista.`;
}

function nextInQueueSentence(
  replacements: readonly (readonly string[])[],
  waitingCount: number,
  seats: number,
): string {
  if (replacements.length === 0) {
    if (waitingCount === 0) return "No hay nadie en la cola.";
    const places = seats === 1 ? "el cupo quedará libre" : "los cupos quedarán libres";
    return `Nadie de la cola cabe automáticamente; ${places}.`;
  }

  const [first] = replacements;
  if (first !== undefined && replacements.length === 1) {
    if (first.length === 2) return `La siguiente en la cola es la pareja ${guestsLabel(first)}.`;
    if (first.length >= 3) return `El siguiente en la cola es el grupo de ${guestsLabel(first)}.`;
    return `La siguiente persona en la cola es ${guestsLabel(first)}.`;
  }

  const names = replacements.map((entry) => guestsLabel(entry)).join(" y ");
  return `Las siguientes en la cola son ${names}.`;
}

const newcomerNote = "Quien entre pasa por revisión, lista y pago.";

export function rejectConfirmation({
  guests,
  replacements,
  waitingCount,
}: ConfirmationInput): string {
  const rejected = `Se rechaza la solicitud de ${guestsLabel(guests)}.`;
  return `${rejected} ${seatsOpenSentence(guests.length)} ${nextInQueueSentence(replacements, waitingCount, guests.length)}`;
}

export function cancelUnpaidConfirmation({
  guests,
  replacements,
  waitingCount,
}: ConfirmationInput): string {
  return `${leavesListSentence(guests)} ${seatsOpenSentence(guests.length)} ${nextInQueueSentence(replacements, waitingCount, guests.length)}`;
}

export function cancelPaidConfirmation({
  guests,
  replacements,
  waitingCount,
}: ConfirmationInput): string {
  const paid = isCouple(guests) ? "Ya pagaron" : "Ya pagó";
  const text = `${leavesListSentence(guests)} ${paid}: quedará pendiente el reembolso. ${seatsOpenSentence(guests.length)} ${nextInQueueSentence(replacements, waitingCount, guests.length)}`;
  return replacements.length === 0 ? text : `${text} ${newcomerNote}`;
}

export function chooseReplacementDescription(seats: number): string {
  return `Elige a quién agregar a la lista en su lugar. ${seatsOpenSentence(seats)}`;
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

export function promoteFromQueueConfirmation(guests: readonly string[]): string {
  return `Se pasará a ${guestsLabel(guests)} de la cola a la lista y se le enviará el mensaje por Instagram.`;
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

export const PAYMENT_MISSING_SENTENCE = " Faltan datos de pago: el mensaje salió sin ellos.";

export function acceptedResult({
  guests,
  outcome,
  paymentMissing,
}: MessageResultInput & { paymentMissing: boolean }): string {
  const verb = isCouple(guests) ? "están" : "está";
  const text = withOutcome(`Aceptaste a ${guestsLabel(guests)}. Ya ${verb} en la lista.`, outcome);
  return paymentMissing ? `${text}${PAYMENT_MISSING_SENTENCE}` : text;
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
