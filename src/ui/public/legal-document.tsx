import type { ReactNode } from "react";

import { getPublicLocale } from "./i18n/locale";
import type { PublicLocale } from "./i18n/messages";
import { legalMessages } from "./i18n/pages";
import { PublicFooter } from "./public-footer";
import { PublicHeader } from "./public-header";

export async function LegalDocument({
  title,
  updatedAt,
  locale: explicitLocale,
  children,
}: {
  title: string;
  updatedAt: string;
  locale?: PublicLocale;
  children: ReactNode;
}) {
  const locale = explicitLocale ?? (await getPublicLocale());
  const messages = legalMessages[locale];

  return (
    <div className="public-page">
      <PublicHeader aboutHref="/" />
      <main className="legal-page">
        <p className="public-eyebrow">CLANDESTINO SUPPER CLAN</p>
        <h1>{title}</h1>
        <p className="legal-updated">
          {messages.lastUpdated}: {updatedAt}
        </p>
        {children}
      </main>
      <PublicFooter locale={locale} />
    </div>
  );
}
