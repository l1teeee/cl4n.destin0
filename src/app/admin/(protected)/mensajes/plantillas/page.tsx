import Link from "next/link";

import { updateTemplateAction } from "@/app/admin/(protected)/mensajes/page-actions";
import { listTemplates } from "@/application/messaging/message-templates";
import { hasPermission } from "@/domain/admin/admin-access";
import { TEMPLATE_VARIABLES } from "@/domain/messaging/message-types";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresMessageTemplateRepository } from "@/infrastructure/db/repositories/postgres-message-template-repository";
import { formatAdminDate } from "@/ui/admin/view-model";
import { TEMPLATE_COPY } from "@/ui/admin/messages/template-copy";
import { TemplateList } from "@/ui/admin/messages/template-list";
import type { TemplateListItem } from "@/ui/admin/messages/template-list-view";
import { Button } from "@/ui/primitives/button";

export default async function MessageTemplatesPage() {
  const authorization = await requireAdmin("page");
  const canSend = hasPermission(authorization.session.admin.role, "templates.edit");
  const templates = await listTemplates(postgresMessageTemplateRepository);
  const items: TemplateListItem[] = templates.map((template) => ({
    key: template.key,
    title: TEMPLATE_COPY[template.key].title,
    timing: TEMPLATE_COPY[template.key].timing,
    body: template.body,
    variables: TEMPLATE_VARIABLES[template.key],
    editedLabel: `Editado ${formatAdminDate(template.updatedAt)}`,
    updatedLabel: `Última edición: ${formatAdminDate(template.updatedAt)} por ${template.updatedBy ?? "Sistema"}`,
  }));

  return (
    <main className="admin-page max-w-3xl space-y-8">
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
      <TemplateList items={items} readOnly={!canSend} action={updateTemplateAction} />
    </main>
  );
}
