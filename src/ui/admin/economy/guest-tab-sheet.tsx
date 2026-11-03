"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import type { ConsumptionLine, EconomyGuest } from "@/application/economy/economy-repository";
import type { PickerItem } from "@/application/extras/extra-repository";
import { formatDrinkPrice } from "@/domain/drink/drink-price";
import { useIsMobile } from "@/ui/hooks/use-mobile";
import { Alert } from "@/ui/primitives/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/ui/primitives/alert-dialog";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/ui/primitives/sheet";
import { Textarea } from "@/ui/primitives/textarea";

import { ConsumptionLines, voidKey } from "./consumption-lines";
import { CustomItemForm } from "./custom-item-form";
import {
  IDLE_ACTION_STATE,
  UNEXPECTED_ERROR_STATE,
  type EconomyHandlers,
} from "./economy-handlers";
import { guestHeading, guestKey, stageLabel } from "./economy-view";
import { QuantityStepper } from "./quantity-stepper";
import { catalogKey, QuickAdd, type CatalogSource } from "./quick-add";

const CUSTOM_KEY = "CUSTOM";
const SETTLE_KEY = "SETTLE";
const REOPEN_KEY = "REOPEN";
const SEND_TAB_KEY = "SEND_TAB";

interface GuestTabSheetProps {
  eventId: string;
  guest: EconomyGuest | null;
  drinks: readonly PickerItem[];
  extras: readonly PickerItem[];
  tabMessage: string | null;
  handlers: EconomyHandlers;
  onClose: () => void;
}

interface GuestTabPanelProps extends Omit<GuestTabSheetProps, "guest" | "onClose"> {
  guest: EconomyGuest;
}

function GuestTabPanel({
  eventId,
  guest,
  drinks,
  extras,
  tabMessage,
  handlers,
}: GuestTabPanelProps) {
  const [quantity, setQuantity] = useState(1);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AdminActionState | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function run(
    key: string,
    call: () => Promise<AdminActionState>,
  ): Promise<AdminActionState> {
    setPendingKey(key);
    setFeedback(null);
    let result: AdminActionState;
    try {
      result = await call();
    } catch {
      result = UNEXPECTED_ERROR_STATE;
    }
    setFeedback(result);
    setPendingKey(null);
    return result;
  }

  function addCatalogItem(source: CatalogSource, item: PickerItem): void {
    const formData = new FormData();
    formData.set("source", source);
    formData.set("itemId", item.id);
    formData.set("quantity", String(quantity));
    void run(catalogKey(source, item), async () => {
      const result = await handlers.add(
        eventId,
        guest.reservationId,
        guest.slot,
        IDLE_ACTION_STATE,
        formData,
      );
      if (result.ok) setQuantity(1);
      return result;
    });
  }

  function addCustomItem(formData: FormData): Promise<AdminActionState> {
    return run(CUSTOM_KEY, () =>
      handlers.add(eventId, guest.reservationId, guest.slot, IDLE_ACTION_STATE, formData),
    );
  }

  function voidLine(line: ConsumptionLine): Promise<AdminActionState> {
    return run(voidKey(line), () =>
      handlers.voidLine(eventId, line.id, IDLE_ACTION_STATE, new FormData()),
    );
  }

  function changeTab(key: string, handler: EconomyHandlers["settle"]): Promise<AdminActionState> {
    return run(key, () =>
      handler(eventId, guest.reservationId, guest.slot, IDLE_ACTION_STATE, new FormData()),
    );
  }

  async function sendTab(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSendError(null);
    const result = await run(SEND_TAB_KEY, () =>
      handlers.sendTab(eventId, guest.reservationId, guest.slot, IDLE_ACTION_STATE, formData),
    );
    if (result.ok) {
      setSendOpen(false);
    } else {
      setSendError(result.message);
    }
  }

  const busy = pendingKey !== null;

  return (
    <>
      <div className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto px-4 pb-4">
        {feedback?.message ? (
          <Alert variant={feedback.ok ? "success" : "destructive"} role="status">
            {feedback.message}
          </Alert>
        ) : null}
        <section className="grid gap-3" aria-label="Agregar consumo">
          <div className="flex items-center justify-between gap-3">
            <h3 className="admin-section-title">Agregar consumo</h3>
            <QuantityStepper value={quantity} onChange={setQuantity} disabled={busy} />
          </div>
          <QuickAdd
            drinks={drinks}
            extras={extras}
            pendingKey={pendingKey}
            onAdd={addCatalogItem}
          />
        </section>
        <section className="grid gap-3">
          <h3 className="admin-section-title">Otro</h3>
          <CustomItemForm
            pending={pendingKey === CUSTOM_KEY}
            disabled={busy}
            onSubmit={addCustomItem}
          />
        </section>
        <section className="grid gap-2">
          <h3 className="admin-section-title">Consumos</h3>
          <ConsumptionLines lines={guest.lines} pendingKey={pendingKey} onVoid={voidLine} />
        </section>
      </div>
      <SheetFooter className="border-t border-border">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">Total de la cuenta</span>
          <span className="text-2xl font-semibold">{formatDrinkPrice(guest.totalCents)}</span>
        </div>
        {tabMessage !== null && !guest.settled ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSendError(null);
                setSendOpen(true);
              }}
            >
              Enviar cuenta a pagar
            </Button>
            <AlertDialog open={sendOpen} onOpenChange={setSendOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Enviar cuenta a pagar</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se envía por Instagram al chat de la reserva. Revisa el texto antes de enviarlo.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <form className="grid gap-4" onSubmit={(event) => void sendTab(event)}>
                  <Textarea
                    name="text"
                    aria-label="Texto de la cuenta"
                    defaultValue={tabMessage}
                    rows={12}
                    maxLength={2000}
                    required
                  />
                  {sendError ? (
                    <Alert variant="destructive" role="status">
                      {sendError}
                    </Alert>
                  ) : null}
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <Button type="submit" disabled={busy}>
                      {pendingKey === SEND_TAB_KEY ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      Enviar cuenta
                    </Button>
                  </AlertDialogFooter>
                </form>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
        {guest.settled ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Reabrir cuenta
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Reabrir la cuenta?</AlertDialogTitle>
                <AlertDialogDescription>
                  La cuenta dejará de figurar como pagada.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void changeTab(REOPEN_KEY, handlers.reopen)}
                >
                  {pendingKey === REOPEN_KEY ? <Loader2 className="size-4 animate-spin" /> : null}
                  Confirmar reapertura
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button
            type="button"
            disabled={busy}
            onClick={() => void changeTab(SETTLE_KEY, handlers.settle)}
          >
            {pendingKey === SETTLE_KEY ? <Loader2 className="size-4 animate-spin" /> : null}
            Marcar pagado
          </Button>
        )}
      </SheetFooter>
    </>
  );
}

export function GuestTabSheet({ guest, onClose, ...panelProps }: GuestTabSheetProps) {
  const isMobile = useIsMobile();

  return (
    <Sheet open={guest !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={
          isMobile
            ? "max-h-[92dvh] border-t border-border"
            : "w-full border-l border-border sm:max-w-md"
        }
      >
        {guest ? (
          <>
            <SheetHeader className="pr-12">
              <SheetTitle>{guestHeading(guest)}</SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={guest.stage === "PAID" ? "confirmed" : "open"}>
                    {stageLabel(guest.stage)}
                  </Badge>
                  {guest.settled ? <Badge variant="active">Pagado</Badge> : null}
                </div>
              </SheetDescription>
            </SheetHeader>
            <GuestTabPanel key={guestKey(guest)} guest={guest} {...panelProps} />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
