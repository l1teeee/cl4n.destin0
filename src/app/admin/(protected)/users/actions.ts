"use server";

import { redirect } from "next/navigation";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import {
  confirmAdminUserDeletion,
  createAdminUser,
  deactivateAdminUser,
  reactivateAdminUser,
  requestAdminUserDeletionCode,
  resetAdminPassword,
  revokeAdminSessions,
  updateAdminUser,
} from "@/application/admin-users/admin-user-use-cases";
import {
  adminDeletionCodeSchema,
  adminUserIdSchema,
  createAdminUserSchema,
  resetAdminPasswordSchema,
  updateAdminUserSchema,
} from "@/contracts/admin-users";
import { requireSuperAdmin } from "@/infrastructure/auth/require-admin";

import {
  adminUserDependencies,
  deniedState,
  errorState,
  revalidateAdminUserPaths,
  validationState,
} from "./action-support";

export async function createAdminUserAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireSuperAdmin("action");
  if (!authorization.authorized) return deniedState(authorization.error);

  const parsed = createAdminUserSchema.safeParse({
    email: formData.get("email"),
    displayName: formData.get("displayName"),
    role: formData.get("role"),
    password: formData.get("password"),
    passwordConfirmation: formData.get("passwordConfirmation"),
  });
  if (!parsed.success) return validationState(parsed.error);

  const result = await createAdminUser(
    adminUserDependencies(),
    authorization.session.admin,
    parsed.data,
  );
  if (!result.ok) return errorState(result.error);

  revalidateAdminUserPaths(result.value.id);
  return {
    ok: true,
    message:
      result.value.notification === "SENT"
        ? `Administrador ${result.value.email} creado. Le enviamos un correo de aviso.`
        : `Administrador ${result.value.email} creado, pero no se pudo enviar el correo de aviso.`,
  };
}

export async function requestAdminUserDeletionCodeAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireSuperAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return deniedState(authorization.error);

  const parsed = adminUserIdSchema.safeParse({ id });
  if (!parsed.success) return validationState(parsed.error);

  const result = await requestAdminUserDeletionCode(
    adminUserDependencies(),
    authorization.session.admin,
    parsed.data.id,
  );
  if (!result.ok) return errorState(result.error);

  return {
    ok: true,
    message: `Te enviamos un código a tu correo. Vence en ${result.value.expiresInMinutes} minutos.`,
  };
}

export async function confirmAdminUserDeletionAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireSuperAdmin("action");
  if (!authorization.authorized) return deniedState(authorization.error);

  const parsed = adminDeletionCodeSchema.safeParse({ id, code: formData.get("code") });
  if (!parsed.success) return validationState(parsed.error);

  const result = await confirmAdminUserDeletion(
    adminUserDependencies(),
    authorization.session.admin,
    { targetId: parsed.data.id, code: parsed.data.code },
  );
  if (!result.ok) return errorState(result.error);

  revalidateAdminUserPaths(parsed.data.id);
  redirect("/admin/users?eliminado=1");
}

export async function updateAdminUserAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireSuperAdmin("action");
  if (!authorization.authorized) return deniedState(authorization.error);

  const parsed = updateAdminUserSchema.safeParse({
    id,
    displayName: formData.get("displayName"),
    role: formData.get("role"),
    expectedRole: formData.get("expectedRole"),
  });
  if (!parsed.success) return validationState(parsed.error);

  const result = await updateAdminUser(
    adminUserDependencies(),
    authorization.session.admin,
    parsed.data,
  );
  if (!result.ok) return errorState(result.error, "No puedes cambiar tu propio rol.");

  revalidateAdminUserPaths(parsed.data.id);
  return { ok: true, message: "Administrador actualizado." };
}

export async function deactivateAdminUserAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireSuperAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return deniedState(authorization.error);

  const parsed = adminUserIdSchema.safeParse({ id });
  if (!parsed.success) return validationState(parsed.error);

  const result = await deactivateAdminUser(
    adminUserDependencies(),
    authorization.session.admin,
    parsed.data.id,
  );
  if (!result.ok) return errorState(result.error, "No puedes desactivar tu propia cuenta.");

  revalidateAdminUserPaths(parsed.data.id);
  return { ok: true, message: "Administrador desactivado. Sus sesiones se cerraron." };
}

export async function reactivateAdminUserAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireSuperAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return deniedState(authorization.error);

  const parsed = adminUserIdSchema.safeParse({ id });
  if (!parsed.success) return validationState(parsed.error);

  const result = await reactivateAdminUser(
    adminUserDependencies(),
    authorization.session.admin,
    parsed.data.id,
  );
  if (!result.ok) return errorState(result.error);

  revalidateAdminUserPaths(parsed.data.id);
  return { ok: true, message: "Administrador reactivado." };
}

export async function resetAdminPasswordAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireSuperAdmin("action");
  if (!authorization.authorized) return deniedState(authorization.error);

  const parsed = resetAdminPasswordSchema.safeParse({
    id,
    password: formData.get("password"),
    passwordConfirmation: formData.get("passwordConfirmation"),
  });
  if (!parsed.success) return validationState(parsed.error);

  const result = await resetAdminPassword(
    adminUserDependencies(),
    authorization.session.admin,
    parsed.data,
  );
  if (!result.ok) return errorState(result.error, "Para cambiar tu contraseña usa Mi cuenta.");

  revalidateAdminUserPaths(parsed.data.id);
  return { ok: true, message: "Contraseña restablecida. Sus sesiones se cerraron." };
}

export async function revokeAdminSessionsAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireSuperAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return deniedState(authorization.error);

  const parsed = adminUserIdSchema.safeParse({ id });
  if (!parsed.success) return validationState(parsed.error);

  const result = await revokeAdminSessions(
    adminUserDependencies(),
    authorization.session.admin,
    parsed.data.id,
  );
  if (!result.ok) return errorState(result.error, "Para cerrar tu sesión usa Cerrar sesión.");

  revalidateAdminUserPaths(parsed.data.id);
  return {
    ok: true,
    message:
      result.value.revokedSessions === 1
        ? "Se cerró 1 sesión."
        : `Se cerraron ${result.value.revokedSessions} sesiones.`,
  };
}
