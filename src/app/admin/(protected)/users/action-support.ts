import { revalidatePath } from "next/cache";
import type { z } from "zod";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { fieldErrorsFromZod } from "@/app/admin/(protected)/form-errors";
import type { AdminUserDependencies } from "@/application/admin-users/admin-user-use-cases";
import type { AdminUserErrorCode } from "@/application/admin-users/types";
import { hashPassword, verifyPassword } from "@/infrastructure/auth/password";
import {
  generateAdminUserDeletionCode,
  hashAdminUserDeletionCode,
} from "@/infrastructure/crypto/admin-user-deletion-code";
import { postgresAdminUserRepository } from "@/infrastructure/db/repositories/postgres-admin-user-repository";
import { adminUserNotifications } from "@/infrastructure/email/admin-user-notifications";
import { log } from "@/infrastructure/observability/logger";
import { consume } from "@/infrastructure/rate-limit/postgres-rate-limiter";

const errorMessages: Record<AdminUserErrorCode, string> = {
  FORBIDDEN: "No tienes permisos para administrar usuarios.",
  NOT_FOUND: "No se encontró el administrador.",
  EMAIL_TAKEN: "Ya existe un administrador con ese email.",
  SELF_ACTION: "No puedes realizar esta acción sobre tu propia cuenta.",
  LAST_SUPER_ADMIN: "Debe quedar al menos un superadministrador activo.",
  ROLE_CHANGED:
    "El rol de este administrador cambió mientras editabas. Recarga la página e inténtalo de nuevo.",
  ALREADY_ACTIVE: "El administrador ya está activo.",
  ALREADY_INACTIVE: "El administrador ya está desactivado.",
  INVALID_CURRENT_PASSWORD: "La contraseña actual no es correcta.",
  SAME_PASSWORD: "La nueva contraseña debe ser diferente a la actual.",
  RATE_LIMITED: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
  CODE_INVALID: "El código no es válido.",
  CODE_EXPIRED: "El código venció. Solicita uno nuevo.",
  TOO_MANY_ATTEMPTS: "Demasiados intentos con este código. Solicita uno nuevo.",
  EMAIL_DELIVERY_FAILED: "No se pudo enviar el código. Inténtalo de nuevo.",
};

const errorFields: Partial<Record<AdminUserErrorCode, string>> = {
  EMAIL_TAKEN: "email",
  INVALID_CURRENT_PASSWORD: "currentPassword",
  SAME_PASSWORD: "newPassword",
};

export function adminUserDependencies(): AdminUserDependencies {
  return {
    repository: postgresAdminUserRepository,
    consumeRateLimit: consume,
    hashPassword,
    verifyPassword,
    notifications: adminUserNotifications,
    generateDeletionCode: generateAdminUserDeletionCode,
    hashDeletionCode: hashAdminUserDeletionCode,
    logError: (message) => log("error", message),
  };
}

export function deniedState(error: "UNAUTHORIZED" | "FORBIDDEN"): AdminActionState {
  return {
    ok: false,
    message:
      error === "FORBIDDEN"
        ? errorMessages.FORBIDDEN
        : "Tu sesión no es válida. Inicia sesión nuevamente.",
  };
}

export function validationState(error: z.ZodError): AdminActionState {
  return {
    ok: false,
    message: "Revisa los campos marcados.",
    fieldErrors: fieldErrorsFromZod(error),
  };
}

export function errorState(
  error: AdminUserErrorCode,
  selfActionMessage?: string,
): AdminActionState {
  const message =
    error === "SELF_ACTION" && selfActionMessage ? selfActionMessage : errorMessages[error];
  const field = errorFields[error];
  return {
    ok: false,
    message,
    fieldErrors: field ? { [field]: message } : undefined,
  };
}

export function revalidateAdminUserPaths(id?: string): void {
  revalidatePath("/admin/users");
  if (id) {
    revalidatePath(`/admin/users/${id}`);
  }
  revalidatePath("/admin/audit");
}
