"use client";

import { MutationForm, type MutationAction } from "@/ui/admin/mutation-form";

const confirmation =
  "Se borrarán para siempre el nombre, el Instagram, las alergias, las notas y los mensajes de esta solicitud y de su grupo. Los lugares y montos se conservan como 'eliminado'. No se puede deshacer.";

interface EraseGuestDataButtonProps {
  action: MutationAction;
  enabled: boolean;
}

export function EraseGuestDataButton({ action, enabled }: EraseGuestDataButtonProps) {
  if (!enabled) {
    return (
      <p className="admin-muted text-sm">Para borrar sus datos, primero cancela la solicitud.</p>
    );
  }
  return (
    <MutationForm
      action={action}
      label="Borrar datos personales"
      confirmation={confirmation}
      danger
      reportToSection
    />
  );
}
