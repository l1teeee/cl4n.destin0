import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { env } from "@/infrastructure/config/env";
import { getPublicLocale } from "@/ui/public/i18n/locale";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.APP_BASE_URL),
  title: { default: "Clandestino Supper Clan", template: "%s | Clandestino Supper Clan" },
  description: "Experiencias privadas de Clandestino Supper Clan",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
  openGraph: { siteName: "Clandestino Supper Clan", type: "website", locale: "es_SV" },
  twitter: { card: "summary_large_image" },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  const locale = await getPublicLocale();

  return (
    <html lang={locale} className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
