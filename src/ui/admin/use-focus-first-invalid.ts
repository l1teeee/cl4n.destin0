"use client";

import { useEffect, type RefObject } from "react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";

export function useFocusFirstInvalid(
  formRef: RefObject<HTMLFormElement | null>,
  state: AdminActionState,
) {
  useEffect(() => {
    if (state.ok || !state.fieldErrors) return;

    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid]')?.focus();
  }, [formRef, state]);
}
