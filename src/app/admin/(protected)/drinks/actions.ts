"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresDrinkRepository } from "@/infrastructure/db/repositories/postgres-drink-repository";

const idSchema = z.string().uuid();

export async function deleteDrinkAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) {
    return { ok: false, message: "Tu sesión no es válida. Inicia sesión nuevamente." };
  }

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, message: "No se encontró la bebida." };
  const deleted = await postgresDrinkRepository.delete(
    parsedId.data,
    authorization.session.admin.id,
  );
  if (!deleted) return { ok: false, message: "No se encontró la bebida." };

  revalidatePath("/admin/drinks");
  revalidatePath("/bebidas");
  revalidatePath("/admin/audit");
  return { ok: true, message: "Bebida eliminada." };
}
