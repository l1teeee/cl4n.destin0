import Link from "next/link";

import { updateTemplateAction } from "@/app/admin/(protected)/mensajes/page-actions";
import { listTemplates } from "@/application/messaging/message-templates";
import { hasPermission } from "@/domain/admin/admin-access";
import { TEMPLATE_VARIABLES, type TemplateKey } from "@/domain/messaging/message-types";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresMessageTemplateRepository } from "@/infrastructure/db/repositories/postgres-message-template-repository";
import { formatAdminDate } from "@/ui/admin/view-model";
import { TemplateEditor } from "@/ui/admin/messages/template-editor";
import { Button } from "@/ui/primitives/button";

const templateCopy: Record<TemplateKey, { title: string; timing: string }> = {
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
};

export default async function MessageTemplatesPage() {
  const authorization = await requireAdmin("page");
  const canSend = hasPermission(authorization.session.admin.role, "templates.edit");
  const templates = await listTemplates(postgresMessageTemplateRepository);

  return (
    <main className="admin-page space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="admin-eyebrow">Mensajes</p>
          <h1 className="admin-title">Plantillas</h1>
          <p className="admin-description">Textos automáticos enviados por Instagram.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/admin/mensajes">Volver a mensajes</Link>
        </Button>
      </div>
      {!canSend ? (
        <p className="admin-muted">
          Solo lectura: solo un superadministrador puede editar las plantillas.
        </p>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        {templates.map((template) => {
          const copy = templateCopy[template.key];
          return (
            <TemplateEditor
              key={template.key}
              templateKey={template.key}
              title={copy.title}
              timing={copy.timing}
              initialBody={template.body}
              variables={TEMPLATE_VARIABLES[template.key]}
              updatedLabel={`Última edición: ${formatAdminDate(template.updatedAt)} por ${template.updatedBy ?? "Sistema"}`}
              readOnly={!canSend}
              action={updateTemplateAction}
            />
          );
        })}
      </div>
    </main>
  );
}
