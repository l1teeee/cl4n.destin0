"use client";

import { useEffect, useRef } from "react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";

type MarkReadAction = (
  contactId: string,
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export function MarkConversationRead({
  contactId,
  action,
}: {
  contactId: string;
  action: MarkReadAction;
}) {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void action(contactId, { ok: false, message: "" }, new FormData());
  }, [action, contactId]);

  return null;
}
