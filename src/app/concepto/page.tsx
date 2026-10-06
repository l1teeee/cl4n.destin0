import Image from "next/image";
import Link from "next/link";

import { PublicHeader } from "@/ui/public/public-header";

export default function ConceptPage() {
  return (
    <div className="public-page">
      <PublicHeader aboutHref="/" aboutLabel="Inicio" />
      <main className="concept-page">
        <div className="concept-visual">
          <Image
            className="concept-image"
            src="/clandestino-wordmark.png"
            alt="Logotipo de Clandestino"
            width={800}
            height={800}
            priority
          />
        </div>
        <div className="concept-copy">
          <p className="public-eyebrow">CLANDESTINO SUPPER CLAN</p>
          <h1>¿Qué es Clandestino?</h1>
          <p>
            Somos más que una cena y menos que un restaurante. Clandestino Supper Clan es una mesa
            creada por cuatro amigos que creen en la cocina honesta y en el poder de compartirla.
            Cocinamos desde lo personal, sin pretensión, para crear noches espontáneas destinadas a
            reunir a las personas alrededor de una mesa.
          </p>
          <div className="concept-links">
            <Link href="/">Volver al inicio</Link>
            <a
              href="https://www.instagram.com/cl4n.destin0/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Instagram
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
