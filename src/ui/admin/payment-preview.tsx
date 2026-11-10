import { paymentMessageValues } from "@/domain/messaging/payment-message";
import type { PaymentSettings } from "@/domain/payment/payment-settings";

interface PaymentPreviewProps {
  settings: PaymentSettings | null;
  priceCents: number | null;
  note: string;
}

export function PaymentPreview({ settings, priceCents, note }: PaymentPreviewProps) {
  const trimmedNote = note.trim();
  const text = paymentMessageValues({
    priceCents,
    partySize: 1,
    settings,
    note: trimmedNote === "" ? null : trimmedNote,
  }).pago;
  return (
    <div className="grid gap-2 rounded-md border border-border p-4">
      <p className="text-xs font-bold tracking-[0.2em] uppercase">Vista previa del pago</p>
      {settings === null ? (
        <p className="admin-muted text-sm">Aún no hay datos bancarios guardados en Mi cuenta.</p>
      ) : null}
      {text === "" ? null : <p className="text-sm whitespace-pre-line text-[#fffbf4]">{text}</p>}
      <p className="admin-muted text-xs">El monto es por persona; en pareja se cobra el doble.</p>
    </div>
  );
}
