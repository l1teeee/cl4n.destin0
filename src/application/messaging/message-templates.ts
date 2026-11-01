import { findUnknownVariables } from "@/domain/messaging/message-template";
import type { TemplateKey } from "@/domain/messaging/message-types";

export interface MessageTemplate {
  key: TemplateKey;
  body: string;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface MessageTemplateRepository {
  listTemplates(): Promise<MessageTemplate[]>;
  updateTemplate(key: TemplateKey, body: string, adminId: string): Promise<MessageTemplate>;
}

export type UpdateTemplateResult =
  { ok: true; template: MessageTemplate } | { ok: false; message: string };

const VARIABLE_MAX_LENGTHS: Record<string, number> = {
  nombre: 120,
  nombres: 243,
  fecha: 60,
  posicion: 3,
  pago: 600,
  ubicacion: 0,
};

const placeholderPattern = /\{([^{}]+)\}/g;

export function maximumRenderedLength(body: string): number {
  return body.replace(placeholderPattern, (placeholder, variable: string) =>
    "x".repeat(VARIABLE_MAX_LENGTHS[variable] ?? placeholder.length),
  ).length;
}

export function listTemplates(repository: MessageTemplateRepository): Promise<MessageTemplate[]> {
  return repository.listTemplates();
}

export async function updateTemplate(
  repository: MessageTemplateRepository,
  key: TemplateKey,
  body: string,
  adminId: string,
): Promise<UpdateTemplateResult> {
  const trimmedBody = body.trim();
  if (trimmedBody.length === 0) {
    return { ok: false, message: "El mensaje no puede estar vacío." };
  }
  if (trimmedBody.length > 1000) {
    return { ok: false, message: "El mensaje no puede superar los 1000 caracteres." };
  }

  const unknownVariables = findUnknownVariables(key, trimmedBody);
  if (unknownVariables.length > 0) {
    return {
      ok: false,
      message: `Estas variables no existen para este mensaje: ${unknownVariables.join(", ")}.`,
    };
  }

  if (maximumRenderedLength(trimmedBody) > 2000) {
    return {
      ok: false,
      message:
        "Con los datos más largos posibles este mensaje superaría el límite de Instagram. Acórtalo.",
    };
  }

  return {
    ok: true,
    template: await repository.updateTemplate(key, trimmedBody, adminId),
  };
}
