import Link from "next/link";
import { publicMessages, type PublicLocale } from "./i18n/messages";
import { LanguageSwitch } from "./language-switch";

// Blank means not configured. A leading @ is dropped so the profile link stays valid.
function configuredInstagramUsername(): string | undefined {
  const username = process.env.NEXT_PUBLIC_INSTAGRAM_USERNAME?.trim().replace(/^@/, "");
  return username ? username : undefined;
}

export function PublicFooter({ locale }: { locale: PublicLocale }) {
  const instagramUsername = configuredInstagramUsername();
  const messages = publicMessages[locale].footer;

  return (
    <footer className="public-footer">
      <p className="public-footer-name">Clandestino</p>
      <nav className="public-footer-links" aria-label={messages.navigation}>
        {instagramUsername ? (
          <a
            href={`https://instagram.com/${encodeURIComponent(instagramUsername)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Instagram
          </a>
        ) : null}
        <Link href="/privacidad">{messages.privacy}</Link>
        <Link href="/terminos">{messages.terms}</Link>
        <LanguageSwitch locale={locale} />
      </nav>
    </footer>
  );
}
