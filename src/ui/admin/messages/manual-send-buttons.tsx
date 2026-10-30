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

export function CopyTextButton({ text, label, disabled = false }: CopyTextButtonProps) {
  const [feedback, setFeedback] = useState<CopyFeedback>("idle");
  const feedbackTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(feedbackTimer.current), []);

  async function copyText() {
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

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      aria-live="polite"
      onClick={() => void copyText()}
    >
      {feedback === "idle" ? label : copyFeedbackLabels[feedback]}
    </Button>
  );
}

export function OpenInstagramChatLink({ username }: { username: string }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={instagramChatHref(username)} target="_blank" rel="noopener noreferrer">
        Abrir chat en Instagram
      </a>
    </Button>
  );
}
