"use server";

import { revalidatePath } from "next/cache";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { eraseGuestData, type GuestErasureResult } from "@/application/guests/guest-erasure";
import { adminGuestIdSchema } from "@/contracts/admin-guest";
import { requirePermission } from "@/infrastructure/auth/require-admin";
import { postgresGuestErasureRepository } from "@/infrastructure/db/repositories/guest-erasure";

const resultMessages: Record<GuestErasureResult, string> = {
  ERASED: "Datos borrados.",
  NOT_FOUND: "No se encontró la solicitud.",
  ACTIVE: "Cancela la solicitud antes de borrar sus datos.",
  ALREADY_ERASED: "Los datos de esta solicitud ya fueron borrados.",
  LIVE_LEASE: "Un mensaje se está enviando. Intenta de nuevo en unos segundos.",
};

export async function eraseGuestDataAction(
  subject: { kind: "RESERVATION" | "WAITLIST_ENTRY"; id: string },
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  void _previousState;
  void _formData;
  const authorization = await requirePermission("privacy.erase", "action");
  if (!authorization.authorized) {
    return {
      ok: false,
      message:
        authorization.error === "FORBIDDEN"
          ? "Solo un superadministrador puede borrar datos personales."
          : "Tu sesión no es válida. Inicia sesión nuevamente.",
    };
  }
  const parsedId = adminGuestIdSchema.safeParse(subject.id);
  if (!parsedId.success) return { ok: false, message: parsedId.error.issues[0]!.message };

  const result = await eraseGuestData(
    postgresGuestErasureRepository,
    subject.kind === "RESERVATION"
      ? { reservationId: parsedId.data }
      : { waitlistEntryId: parsedId.data },
    authorization.session.admin.id,
  );
  if (result === "ERASED") {
    revalidatePath("/admin/events/[id]", "page");
    revalidatePath("/admin/audit");
    revalidatePath("/admin/mensajes");
  }
  return { ok: result === "ERASED", message: resultMessages[result] };
}
