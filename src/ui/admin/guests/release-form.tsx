"use client";

import { useState, type ReactNode } from "react";

import type {
  PromotionPreviewEntry,
  WaitingQueueEntry,
} from "@/infrastructure/db/repositories/event-guest-queries";
import { MutationForm, type MutationAction } from "@/ui/admin/mutation-form";
import { Button } from "@/ui/primitives/button";

import { ExpectedReplacementInputs } from "./expected-replacement-inputs";
import {
  cancelPaidConfirmation,
  cancelUnpaidConfirmation,
  chooseReplacementDescription,
  rejectConfirmation,
} from "./guest-copy";
import { QueueReplacementList } from "./queue-replacement-list";

export type ReleaseKind = "REJECT" | "CANCEL_UNPAID" | "CANCEL_PAID";

type ReleaseView = "summary" | "queue";

interface ReleaseFormProps {
  action: MutationAction;
  label: string;
  kind: ReleaseKind;
  guests: readonly string[];
  waitingCount: number;
  autoEntries: readonly PromotionPreviewEntry[];
  waiting: readonly WaitingQueueEntry[];
  children?: ReactNode;
}

const confirmationByKind = {
  REJECT: rejectConfirmation,
  CANCEL_UNPAID: cancelUnpaidConfirmation,
  CANCEL_PAID: cancelPaidConfirmation,
} satisfies Record<ReleaseKind, typeof rejectConfirmation>;

// Rejecting or cancelling frees the seats of the released request; the dialog says who the
// automatic promotion takes and lets the admin pick someone else from the cola instead.
export function ReleaseForm({
  action,
  label,
  kind,
  guests,
  waitingCount,
  autoEntries,
  waiting,
  children,
}: ReleaseFormProps) {
  const [view, setView] = useState<ReleaseView>("summary");
  const choosing = view === "queue";

  const description = choosing
    ? chooseReplacementDescription(guests.length)
    : confirmationByKind[kind]({
        guests,
        replacements: autoEntries.map((entry) => entry.guests),
        waitingCount,
      });

  return (
    <MutationForm
      action={action}
      label={label}
      confirmation={description}
      danger
      reportToSection
      submitDisabled={choosing}
      onOpenChange={() => setView("summary")}
    >
      <input type="hidden" name="replacementMode" value={choosing ? "chosen" : "auto"} />
      <div key={view} className="animate-in duration-200 fade-in-0 motion-reduce:animate-none">
        {choosing ? (
          <QueueReplacementList
            waiting={waiting}
            releasedSeats={guests.length}
            onBack={() => setView("summary")}
          />
        ) : (
          <>
            <ExpectedReplacementInputs entryIds={autoEntries.map((entry) => entry.id)} />
            {waiting.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-fit"
                onClick={() => setView("queue")}
              >
                Seleccionar de la lista de colas
              </Button>
            ) : null}
          </>
        )}
      </div>
      {children}
    </MutationForm>
  );
}
