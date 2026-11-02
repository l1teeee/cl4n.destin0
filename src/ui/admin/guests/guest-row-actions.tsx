import { ArrowDown, ArrowUp } from "lucide-react";

import type {
  EventGuestRow,
  PromotionPreview,
} from "@/infrastructure/db/repositories/event-guest-queries";
import { MutationForm } from "@/ui/admin/mutation-form";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";

import type { GuestActionHandlers } from "./guest-action-handlers";
import {
  acceptConfirmation,
  promoteFromQueueConfirmation,
  refundConfirmation,
  removeFromQueueConfirmation,
  verifyPaymentConfirmation,
} from "./guest-copy";
import { GuestMessageToggle } from "./guest-message-toggle";
import { guestNames } from "./guest-row-view";
import { ReleaseForm } from "./release-form";

interface GuestRowActionsProps {
  row: EventGuestRow;
  preview: PromotionPreview;
  freeSeats: number;
  queueSize: number;
  handlers: GuestActionHandlers;
}

interface ReleaseActionProps {
  row: EventGuestRow;
  preview: PromotionPreview;
  handlers: GuestActionHandlers;
}

interface QueueActionsProps {
  row: EventGuestRow;
  freeSeats: number;
  queueSize: number;
  handlers: GuestActionHandlers;
}

interface MoveButtonProps {
  row: EventGuestRow;
  direction: "UP" | "DOWN";
  disabled: boolean;
  handlers: GuestActionHandlers;
}

// Freeing a couple's two seats can let in more queue entries than freeing one seat does.
function replacementsIfReleased(row: EventGuestRow, preview: PromotionPreview) {
  return row.partySize === 2 ? preview.twoSeats : preview.oneSeat;
}

function ReviewActions({ row, preview, handlers }: ReleaseActionProps) {
  const replacements = replacementsIfReleased(row, preview);

  return (
    <>
      <MutationForm
        action={handlers.accept.bind(null, row.id)}
        label="Aceptar"
        confirmation={acceptConfirmation}
        reportToSection
      />
      <ReleaseForm
        action={handlers.reject.bind(null, row.id)}
        label="Rechazar"
        kind="REJECT"
        guests={guestNames(row)}
        waitingCount={preview.waitingCount}
        autoEntries={replacements}
        waiting={preview.waiting}
      >
        <GuestMessageToggle />
      </ReleaseForm>
    </>
  );
}

function VerifyPaymentAction({ row, handlers }: Omit<ReleaseActionProps, "preview">) {
  return (
    <MutationForm
      action={handlers.verifyPayment.bind(null, row.id)}
      label="Pago verificado"
      confirmation={verifyPaymentConfirmation(guestNames(row))}
      reportToSection
    >
      <Label className="grid gap-2">
        <span>Referencia del pago</span>
        <Input name="paymentNote" maxLength={200} autoComplete="off" placeholder="Opcional" />
      </Label>
    </MutationForm>
  );
}

// The stage the dialog describes is posted, so the server refuses the cancellation when the
// payment status changed after the page loaded and the wording no longer fits.
function CancelFromListAction({
  row,
  stage,
  preview,
  handlers,
}: ReleaseActionProps & { stage: "ON_LIST" | "PAID" }) {
  return (
    <ReleaseForm
      action={handlers.cancel.bind(null, row.id)}
      label="Sacar de la lista"
      kind={stage === "PAID" ? "CANCEL_PAID" : "CANCEL_UNPAID"}
      guests={guestNames(row)}
      waitingCount={preview.waitingCount}
      autoEntries={replacementsIfReleased(row, preview)}
      waiting={preview.waiting}
    >
      <input type="hidden" name="expectedStage" value={stage} />
      <GuestMessageToggle />
    </ReleaseForm>
  );
}

function MoveButton({ row, direction, disabled, handlers }: MoveButtonProps) {
  const label = direction === "UP" ? "Subir" : "Bajar";
  const icon = direction === "UP" ? <ArrowUp /> : <ArrowDown />;

  if (disabled) {
    return (
      <Button variant="ghost" size="icon-sm" aria-label={label} disabled>
        {icon}
      </Button>
    );
  }

  return (
    <MutationForm
      action={handlers.move.bind(null, row.id)}
      label={label}
      icon={icon}
      reportToSection
    >
      <input type="hidden" name="direction" value={direction} />
    </MutationForm>
  );
}

function QueueActions({ row, freeSeats, queueSize, handlers }: QueueActionsProps) {
  const atHead = row.position === 1;
  const atTail = row.position !== null && row.position >= queueSize;

  return (
    <>
      <MoveButton row={row} direction="UP" disabled={atHead} handlers={handlers} />
      <MoveButton row={row} direction="DOWN" disabled={atTail} handlers={handlers} />
      {row.partySize <= freeSeats ? (
        <MutationForm
          action={handlers.promote.bind(null, row.id)}
          label="Pasar a la lista"
          confirmation={promoteFromQueueConfirmation(guestNames(row))}
          reportToSection
        />
      ) : null}
      <MutationForm
        action={handlers.remove.bind(null, row.id)}
        label="Quitar de la cola"
        confirmation={removeFromQueueConfirmation(guestNames(row))}
        danger
        reportToSection
      >
        <GuestMessageToggle />
      </MutationForm>
    </>
  );
}

function RefundAction({ row, handlers }: Omit<ReleaseActionProps, "preview">) {
  return (
    <MutationForm
      action={handlers.markRefunded.bind(null, row.id)}
      label="Reembolso realizado"
      confirmation={refundConfirmation(guestNames(row))}
      reportToSection
    >
      <GuestMessageToggle />
    </MutationForm>
  );
}

export function GuestRowActions({
  row,
  preview,
  freeSeats,
  queueSize,
  handlers,
}: GuestRowActionsProps) {
  if (row.kind === "WAITLIST_ENTRY") {
    if (row.status !== "WAITING") return null;
    return (
      <QueueActions row={row} freeSeats={freeSeats} queueSize={queueSize} handlers={handlers} />
    );
  }

  if (row.status === "CANCELLED") {
    return row.refundStatus === "PENDING" ? <RefundAction row={row} handlers={handlers} /> : null;
  }

  if (row.status !== "CONFIRMED") return null;
  if (row.stage === "IN_REVIEW") {
    return <ReviewActions row={row} preview={preview} handlers={handlers} />;
  }
  if (row.stage === "ON_LIST") {
    return (
      <>
        <VerifyPaymentAction row={row} handlers={handlers} />
        <CancelFromListAction row={row} stage="ON_LIST" preview={preview} handlers={handlers} />
      </>
    );
  }
  if (row.stage === "PAID") {
    return <CancelFromListAction row={row} stage="PAID" preview={preview} handlers={handlers} />;
  }
  return null;
}
