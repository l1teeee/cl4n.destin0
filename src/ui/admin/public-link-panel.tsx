"use client";

import { useState } from "react";

import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";

interface PublicLinkPanelProps {
  url: string;
  hint: string | null;
}

export function PublicLinkPanel({ url, hint }: PublicLinkPanelProps) {
  const [revealed, setRevealed] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  async function copyLink() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(url);
      setCopyStatus("Enlace copiado.");
    } catch {
      setCopyStatus("No se pudo copiar. Selecciona el enlace y cópialo manualmente.");
    }
  }

  function revealLink() {
    setRevealed(true);
    void copyLink();
  }

  return (
    <div className="space-y-3">
      {revealed ? (
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="w-full max-w-xl"
            value={url}
            readOnly
            aria-label="Enlace público"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button type="button" onClick={() => void copyLink()}>
            Copiar enlace
          </Button>
          <Button variant="link" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              Abrir enlace
            </a>
          </Button>
        </div>
      ) : (
        <Button type="button" onClick={revealLink}>
          Generar link para público
        </Button>
      )}
      {hint ? <p className="admin-muted">{hint}</p> : null}
      {copyStatus ? <p role="status">{copyStatus}</p> : null}
    </div>
  );
}
