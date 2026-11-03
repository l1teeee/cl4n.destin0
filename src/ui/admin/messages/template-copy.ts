import type { TemplateKey } from "@/domain/messaging/message-types";

export const TEMPLATE_COPY: Record<TemplateKey, { title: string; timing: string }> = {
  REQUEST_RECEIVED: {
    title: "Solicitud recibida",
    timing: "Cuando la persona nos escribe después de llenar el formulario y tiene lugar",
  },
  WAITLISTED: { title: "En la cola", timing: "Cuando nos escribe y quedó en la cola" },
  PROMOTED: { title: "Entrada desde la cola", timing: "Cuando entra desde la cola" },
  ON_LIST: { title: "En la lista", timing: "Al aceptarla" },
  PAID: { title: "Pago verificado", timing: "Al verificar el pago" },
  REJECTED: {
    title: "Solicitud rechazada",
    timing: "Al rechazarla o quitarla de la cola, si eliges enviarlo",
  },
  CANCELLED_UNPAID: {
    title: "Cancelación sin pago",
    timing: "Al eliminarla de la lista sin pago, si eliges enviarlo",
  },
  CANCELLED_PAID: {
    title: "Cancelación con pago",
    timing: "Al cancelar a alguien que ya pagó, si eliges enviarlo",
  },
  REFUNDED: {
    title: "Reembolso",
    timing: "Al registrar el reembolso, si eliges enviarlo",
  },
  LOCATION: { title: "Ubicación", timing: "Al enviar la ubicación" },
  TAB: { title: "Cuenta de consumos", timing: "Al enviar la cuenta desde Extras" },
};
