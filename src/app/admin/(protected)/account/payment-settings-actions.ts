"use server";

import { revalidatePath } from "next/cache";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { fieldErrorsFromZod } from "@/app/admin/(protected)/form-errors";
import { savePaymentSettings } from "@/application/payments/payment-settings";
import {
  paymentSettingsSchema,
  readPaymentSettingsFormData,
} from "@/contracts/admin-payment-settings";
import { requirePermission } from "@/infrastructure/auth/require-admin";
import { postgresPaymentSettingsRepository } from "@/infrastructure/db/repositories/postgres-payment-settings-repository";

export async function savePaymentSettingsAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requirePermission("payments.manage", "action");
  if (!authorization.authorized) {
    return authorization.error === "FORBIDDEN"
      ? { ok: false, message: "Solo un superadministrador puede cambiar los datos de pago." }
      : { ok: false, message: "Tu sesión no es válida. Inicia sesión nuevamente." };
  }

  const parsed = paymentSettingsSchema.safeParse(readPaymentSettingsFormData(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  await savePaymentSettings(
    postgresPaymentSettingsRepository,
    parsed.data,
    authorization.session.admin.id,
  );

  revalidatePath("/admin/account");
  revalidatePath("/admin/audit");
  return { ok: true, message: "Datos de pago guardados." };
}
