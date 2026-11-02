"use client";

import { useActionState, useMemo, useRef, useState } from "react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { findUnknownVariables, renderMessageTemplate } from "@/domain/messaging/message-template";
import type { TemplateKey } from "@/domain/messaging/message-types";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { Textarea } from "@/ui/primitives/textarea";

const sampleValues = {
  nombre: "Ana",
  nombres: "Ana y Luis",
  fecha: "sábado 14 de noviembre, 7:00 p. m.",
  posicion: "2",
  pago: "Transferencia a ... (ejemplo)",
  ubicacion: "Casa Clandestina\nCalle ...\nhttps://maps.google.com/...",
};

type TemplateAction = (
  key: string,
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

const initialState: AdminActionState = { ok: false, message: "" };

export interface TemplateEditorProps {
  templateKey: TemplateKey;
  title: string;
  initialBody: string;
  variables: readonly string[];
  updatedLabel: string;
  readOnly: boolean;
  action: TemplateAction;
}

export function TemplateEditor({
  templateKey,
  title,
  initialBody,
  variables,
  updatedLabel,
  readOnly,
  action,
}: TemplateEditorProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState(initialBody);
  const [state, formAction, pending] = useActionState(action.bind(null, templateKey), initialState);
  const unknownVariables = useMemo(
    () => findUnknownVariables(templateKey, body),
    [body, templateKey],
  );
  const preview = renderMessageTemplate(body, sampleValues);

  function insertVariable(variable: string) {
    const field = textarea.current;
    const placeholder = `{${variable}}`;
    const start = field?.selectionStart ?? body.length;
    const end = field?.selectionEnd ?? start;
    setBody(`${body.slice(0, start)}${placeholder}${body.slice(end)}`);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  }

  return (
    <form action={formAction} className="grid gap-4 pt-2 pb-5">
      <Textarea
        ref={textarea}
        name="body"
        aria-label={`Texto de ${title}`}
        value={body}
        onChange={(event) => setBody(event.currentTarget.value)}
        maxLength={1000}
        rows={4}
        className="max-h-[calc(12lh+1.5rem)] min-h-[calc(4lh+1.5rem)] overflow-y-auto"
        readOnly={readOnly}
        required
      />
      <div className="flex flex-wrap gap-2" aria-label={`Variables de ${title}`}>
        {variables.map((variable) => (
          <Button
            key={variable}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => insertVariable(variable)}
          >
            {`{${variable}}`}
          </Button>
        ))}
      </div>
      <p className="text-right text-xs text-[#8d8b85]">{body.length}/1000</p>
      {unknownVariables.length > 0 ? (
        <Alert variant="destructive" role="alert">
          Estas variables no existen para este mensaje: {unknownVariables.join(", ")}.
        </Alert>
      ) : null}
      <div className="grid gap-2 border border-border bg-accent p-4">
        <p className="admin-eyebrow">Vista previa</p>
        <p className="whitespace-pre-line">{preview || "El mensaje está vacío."}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="admin-muted text-xs">{updatedLabel}</p>
        {readOnly ? null : (
          <Button type="submit" disabled={pending || unknownVariables.length > 0}>
            {pending ? "Guardando..." : "Guardar"}
          </Button>
        )}
      </div>
      {state.message ? (
        <Alert variant={state.ok ? "success" : "destructive"} role="status">
          {state.message}
        </Alert>
      ) : null}
    </form>
  );
}
