import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { getPublicLocale } from "@/ui/public/i18n/locale";
import { conceptMessages } from "@/ui/public/i18n/pages";
import { PublicHeader } from "@/ui/public/public-header";
import { PublicFooter } from "@/ui/public/public-footer";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getPublicLocale();
  return {
    title: conceptMessages[locale].metaTitle,
  };
}

export default async function ConceptPage() {
  const locale = await getPublicLocale();
  const messages = conceptMessages[locale];

  return (
    <div className="public-page">
      <PublicHeader aboutHref="/" />
      <main className="concept-page">
        <div className="concept-visual">
          <Image
            className="concept-image"
            src="/clandestino-wordmark.png"
            alt={messages.logoAlt}
            width={800}
            height={800}
            priority
          />
        </div>
        <div className="concept-copy">
          <p className="public-eyebrow">{messages.eyebrow}</p>
          <h1>{messages.title}</h1>
          <p>{messages.paragraph}</p>
          <div className="concept-links">
            <Link href="/">{messages.backHome}</Link>
            <a
              href="https://www.instagram.com/cl4n.destin0/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {messages.instagram}
            </a>
          </div>
        </div>
      </main>
      <PublicFooter locale={locale} />
    </div>
  );
}
