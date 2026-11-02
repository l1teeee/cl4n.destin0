"use client";

import { useRouter } from "next/navigation";

import type { PublicLocale } from "./i18n/messages";

export function LanguageSwitch({ locale, label }: { locale: PublicLocale; label: string }) {
  const router = useRouter();

  function selectLanguage(language: PublicLocale) {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `cl4n_lang=${language}; Path=/; SameSite=Lax; Max-Age=31536000${secure}`;
    router.refresh();
  }

  return (
    <div className="public-language-switch" role="group" aria-label={label}>
      <button
        type="button"
        lang="es"
        aria-pressed={locale === "es"}
        onClick={() => selectLanguage("es")}
      >
        ES
      </button>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        lang="en"
        aria-pressed={locale === "en"}
        onClick={() => selectLanguage("en")}
      >
        EN
      </button>
    </div>
  );
}
