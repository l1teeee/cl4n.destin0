import { revalidatePath } from "next/cache";
import type { z } from "zod";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import type { AdminUserDependencies } from "@/application/admin-users/admin-user-use-cases";
import type { AdminUserErrorCode } from "@/application/admin-users/types";
import { hashPassword, verifyPassword } from "@/infrastructure/auth/password";
import { postgresAdminUserRepository } from "@/infrastructure/db/repositories/postgres-admin-user-repository";
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
};

export function adminUserDependencies(): AdminUserDependencies {
  return {
    repository: postgresAdminUserRepository,
    consumeRateLimit: consume,
    hashPassword,
    verifyPassword,
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
  return { ok: false, message: error.issues[0]?.message ?? "Revisa los datos del formulario." };
}

export function errorState(
  error: AdminUserErrorCode,
  selfActionMessage?: string,
): AdminActionState {
  return {
    ok: false,
    message:
      error === "SELF_ACTION" && selfActionMessage ? selfActionMessage : errorMessages[error],
  };
}

export function revalidateAdminUserPaths(id?: string): void {
  revalidatePath("/admin/users");
  if (id) {
    revalidatePath(`/admin/users/${id}`);
  }
  revalidatePath("/admin/audit");
}
