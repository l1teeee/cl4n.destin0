import Link from "next/link";

import { getPublicLocale } from "@/ui/public/i18n/locale";
import { publicMessages } from "@/ui/public/i18n/messages";
import { PublicLanding } from "@/ui/public/public-landing";

export default async function NotFound() {
  const locale = await getPublicLocale();
  const messages = publicMessages[locale].notFound;

  return (
    <PublicLanding status={messages.title}>
      <p className="public-home-copy">{messages.copy}</p>
      <Link href="/" className="public-not-found-link">
        {messages.back}
      </Link>
    </PublicLanding>
  );
}
