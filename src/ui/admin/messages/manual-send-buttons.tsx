"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/ui/primitives/button";

import { instagramChatHref } from "./message-copy";

const FEEDBACK_DURATION_MS = 2000;

type CopyFeedback = "idle" | "copied" | "failed";

const copyFeedbackLabels = { copied: "Copiado", failed: "No se pudo copiar" } as const;

interface CopyTextButtonProps {
  text: string;
  label: string;
  disabled?: boolean;
}

function useCopyFeedback(): { feedback: CopyFeedback; copy(text: string): Promise<void> } {
  const [feedback, setFeedback] = useState<CopyFeedback>("idle");
  const feedbackTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(feedbackTimer.current), []);

  async function copy(text: string): Promise<void> {
    let result: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      result = "failed";
    }

    setFeedback(result);
    window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setFeedback("idle"), FEEDBACK_DURATION_MS);
  }

  return { feedback, copy };
}

export function CopyTextButton({ text, label, disabled = false }: CopyTextButtonProps) {
  const { feedback, copy } = useCopyFeedback();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      aria-live="polite"
      onClick={() => void copy(text)}
    >
      {feedback === "idle" ? label : copyFeedbackLabels[feedback]}
    </Button>
  );
}

export function OpenInstagramChatLink({
  username,
  text = null,
}: {
  username: string;
  text?: string | null;
}) {
  const { feedback, copy } = useCopyFeedback();

  if (text === null) {
    return (
      <Button variant="outline" size="sm" asChild>
        <a href={instagramChatHref(username)} target="_blank" rel="noopener noreferrer">
          Abrir chat en Instagram
        </a>
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" asChild>
      <a
        href={instagramChatHref(username)}
        target="_blank"
        rel="noopener noreferrer"
        aria-live="polite"
        onClick={() => void copy(text)}
      >
        {feedback === "idle" ? "Enviar por Instagram" : copyFeedbackLabels[feedback]}
      </a>
    </Button>
  );
}

// Opens the guest's chat with the text copied; without a username the text can only be copied.
export function ManualSendButton({
  username,
  text,
}: {
  username: string | null;
  text: string | null;
}) {
  if (username) return <OpenInstagramChatLink username={username} text={text} />;
  if (text) return <CopyTextButton text={text} label="Copiar texto" />;
  return null;
}
