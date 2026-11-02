"use server";

import { revalidatePath } from "next/cache";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { requirePermission } from "@/infrastructure/auth/require-admin";
import { disconnectConfiguredInstagram } from "@/infrastructure/instagram/instagram-connection-runtime";

export async function disconnectInstagramAction(
  _state: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requirePermission("instagram.connect", "action");
  void _state;
  void _formData;
  if (!authorization.authorized) {
    return { ok: false, message: "Tu sesión no es válida. Inicia sesión nuevamente." };
  }
  const result = await disconnectConfiguredInstagram(authorization.session.admin.id);
  if (!result.ok) return { ok: false, message: "Instagram no está vinculado." };
  revalidatePath("/admin/account");
  return { ok: true, message: "Instagram desvinculado." };
}
