"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { retryEmail } from "@/application/notifications/retry-email";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { scheduleEmailDelivery } from "@/infrastructure/email/outbox/schedule-email-delivery";
import { postgresEmailOutboxRepository } from "@/infrastructure/email/outbox/postgres-email-outbox-repository";

const emailIdSchema = z.uuid("El identificador no es válido.");

export async function retryEmailAction(id: string): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  if (!authorization.authorized) {
    return { ok: false, message: "Tu sesión no es válida. Inicia sesión nuevamente." };
  }

  const parsed = emailIdSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]!.message };
  }

  const requeued = await retryEmail(postgresEmailOutboxRepository, parsed.data);
  if (!requeued) {
    return { ok: false, message: "Solo se pueden reintentar correos fallidos." };
  }

  scheduleEmailDelivery();
  revalidatePath("/admin/emails");
  return { ok: true, message: "Correo en cola para reintento." };
}
