"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { PublicLocale } from "./i18n/messages";

export function LanguageSwitch({ locale }: { locale: PublicLocale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const switching = useRef(false);
  const language = locale === "es" ? "en" : "es";

  useEffect(() => {
    if (switching.current && !isPending) {
      document.documentElement.removeAttribute("data-lang-switching");
      switching.current = false;
      timer.current = null;
    }
  }, [isPending]);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      document.documentElement.removeAttribute("data-lang-switching");
    };
  }, []);

  function selectLanguage() {
    if (timer.current !== null) return;
    document.documentElement.setAttribute("data-lang-switching", "");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timer.current = setTimeout(
      () => {
        const secure = window.location.protocol === "https:" ? "; Secure" : "";
        document.cookie = `cl4n_lang=${language}; Path=/; SameSite=Lax; Max-Age=31536000${secure}`;
        switching.current = true;
        startTransition(() => router.refresh());
      },
      reducedMotion ? 0 : 200,
    );
  }

  return (
    <button
      className="public-language-switch"
      type="button"
      lang={language}
      aria-label={locale === "es" ? "Cambiar idioma a inglés" : "Change language to Spanish"}
      disabled={isPending}
      onClick={selectLanguage}
    >
      {locale === "es" ? "English" : "Español"}
    </button>
  );
}
