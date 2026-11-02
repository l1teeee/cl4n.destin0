import type { ReactNode } from "react";

import { PublicFooter } from "./public-footer";
import { PublicHeader } from "./public-header";

export function LegalDocument({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: ReactNode;
}) {
  return (
    <div className="public-page">
      <PublicHeader aboutHref="/" aboutLabel="Inicio" />
      <main className="legal-page">
        <p className="public-eyebrow">CLANDESTINO SUPPER CLAN</p>
        <h1>{title}</h1>
        <p className="legal-updated">Última actualización: {updatedAt}</p>
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
