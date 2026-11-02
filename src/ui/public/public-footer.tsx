import Link from "next/link";
import { publicMessages, type PublicLocale } from "./i18n/messages";
import { configuredInstagramUsername, instagramProfileUrl } from "./instagram-profile";
import { LanguageSwitch } from "./language-switch";

export function PublicFooter({ locale }: { locale: PublicLocale }) {
  const instagramUsername = configuredInstagramUsername();
  const messages = publicMessages[locale].footer;

  return (
    <footer className="public-footer">
      <p className="public-footer-name">Clandestino</p>
      <nav className="public-footer-links" aria-label={messages.navigation}>
        {instagramUsername ? (
          <a
            href={instagramProfileUrl(instagramUsername)}
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
