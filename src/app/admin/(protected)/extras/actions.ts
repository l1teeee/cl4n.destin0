"use server";

import { revalidatePath } from "next/cache";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { fieldErrorsFromZod } from "@/app/admin/(protected)/form-errors";
import { createExtra, deleteExtra, updateExtra } from "@/application/extras/extra-use-cases";
import { extraFormSchema, extraIdSchema, readExtraFormData } from "@/contracts/admin-extra";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresExtraRepository } from "@/infrastructure/db/repositories/postgres-extra-repository";

const UNAUTHORIZED: AdminActionState = {
  ok: false,
  message: "Tu sesión no es válida. Inicia sesión nuevamente.",
};
const EXTRA_NOT_FOUND: AdminActionState = { ok: false, message: "No se encontró el extra." };

function revalidateExtraPaths(): void {
  revalidatePath("/admin/extras");
  revalidatePath("/admin/audit");
}

export async function createExtraAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  if (!authorization.authorized) return UNAUTHORIZED;

  const parsed = extraFormSchema.safeParse(readExtraFormData(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  await createExtra(postgresExtraRepository, {
    ...parsed.data,
    actorId: authorization.session.admin.id,
  });
  revalidateExtraPaths();
  return { ok: true, message: "Extra creado." };
}

export async function updateExtraAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  if (!authorization.authorized) return UNAUTHORIZED;

  const parsedId = extraIdSchema.safeParse(id);
  if (!parsedId.success) return EXTRA_NOT_FOUND;
  const parsed = extraFormSchema.safeParse(readExtraFormData(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const updated = await updateExtra(postgresExtraRepository, {
    ...parsed.data,
    id: parsedId.data,
    actorId: authorization.session.admin.id,
  });
  if (!updated) return EXTRA_NOT_FOUND;

  revalidateExtraPaths();
  return { ok: true, message: "Extra actualizado." };
}

export async function deleteExtraAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return UNAUTHORIZED;

  const parsedId = extraIdSchema.safeParse(id);
  if (!parsedId.success) return EXTRA_NOT_FOUND;
  const deleted = await deleteExtra(
    postgresExtraRepository,
    parsedId.data,
    authorization.session.admin.id,
  );
  if (!deleted) return EXTRA_NOT_FOUND;

  revalidateExtraPaths();
  return { ok: true, message: "Extra eliminado." };
}
