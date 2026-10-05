"use server";

import { revalidatePath } from "next/cache";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import {
  adminUserDependencies,
  deniedState,
  errorState,
  validationState,
} from "@/app/admin/(protected)/users/action-support";
import { changeOwnPassword } from "@/application/admin-users/admin-user-use-cases";
import { changeOwnPasswordSchema } from "@/contracts/admin-users";
import { requireAdmin } from "@/infrastructure/auth/require-admin";

export async function changeOwnPasswordAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  if (!authorization.authorized) return deniedState("UNAUTHORIZED");

  const parsed = changeOwnPasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    newPasswordConfirmation: formData.get("newPasswordConfirmation"),
  });
  if (!parsed.success) return validationState(parsed.error);

  const result = await changeOwnPassword(
    adminUserDependencies(),
    { adminId: authorization.session.admin.id, sessionId: authorization.session.id },
    { currentPassword: parsed.data.currentPassword, newPassword: parsed.data.newPassword },
  );
  if (!result.ok) return errorState(result.error);

  revalidatePath("/admin/account");
  revalidatePath("/admin/audit");
  return { ok: true, message: "Contraseña actualizada. Se cerraron tus otras sesiones." };
}
