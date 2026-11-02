import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { getPublicLocale } from "@/ui/public/i18n/locale";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clandestino",
  description: "Experiencias privadas Clandestino",
  icons: { icon: "/clandestino-logo.jpg", apple: "/clandestino-logo.jpg" },
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
