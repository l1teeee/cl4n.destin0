"use server";

import { revalidatePath } from "next/cache";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { updateTemplate } from "@/application/messaging/message-templates";
import { TEMPLATE_KEYS, type TemplateKey } from "@/domain/messaging/message-types";
import { requirePermission } from "@/infrastructure/auth/require-admin";
import { postgresMessageTemplateRepository } from "@/infrastructure/db/repositories/postgres-message-template-repository";

function isTemplateKey(value: string): value is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(value);
}

export async function updateTemplateAction(
  key: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requirePermission("templates.edit", "action");
  void _previousState;
  if (!authorization.authorized) {
    return {
      ok: false,
      message:
        authorization.error === "FORBIDDEN"
          ? "Solo un superadministrador puede enviar o cambiar mensajes."
          : "Tu sesión no es válida. Inicia sesión nuevamente.",
    };
  }
  if (!isTemplateKey(key)) {
    return { ok: false, message: "La plantilla no es válida." };
  }

  const result = await updateTemplate(
    postgresMessageTemplateRepository,
    key,
    String(formData.get("body") ?? ""),
    authorization.session.admin.id,
  );
  if (!result.ok) return result;

  revalidatePath("/admin/mensajes/plantillas");
  return { ok: true, message: "Plantilla guardada." };
}
