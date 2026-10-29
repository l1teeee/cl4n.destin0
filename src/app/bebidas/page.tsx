import type { Metadata } from "next";

import { formatDrinkPrice } from "@/domain/drink/drink-price";
import { postgresDrinkRepository } from "@/infrastructure/db/repositories/postgres-drink-repository";
import { DrinkDetailsDialog } from "@/ui/drink-details-dialog";
import { PublicHeader } from "@/ui/public/public-header";

import "./bebidas.css";

export const metadata: Metadata = { title: "Bebidas · Clandestino" };

export default async function DrinksMenuPage() {
  const drinks = await postgresDrinkRepository.listVisible();

  return (
    <div className="public-page">
      <PublicHeader aboutHref="/" aboutLabel="Inicio" />
      <main className="drinks-page">
        <header className="drinks-intro">
          <p className="public-eyebrow">CLANDESTINO SUPPER CLAN</p>
          <h1>Bebidas</h1>
        </header>
        {drinks.length === 0 ? (
          <p>El menú de bebidas estará disponible pronto.</p>
        ) : (
          <ul className="drinks-list">
            {drinks.map((drink) => (
              <li key={drink.id} className="drink-item">
                {drink.imageId ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    className="drink-image"
                    src={`/bebidas/imagen/${drink.imageId}`}
                    alt={drink.name}
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}
                <div className="drink-copy">
                  <h2>
                    <DrinkDetailsDialog
                      name={drink.name}
                      description={drink.description}
                      price={formatDrinkPrice(drink.priceCents)}
                      imageUrl={drink.imageId ? `/bebidas/imagen/${drink.imageId}` : null}
                    >
                      <button type="button" className="drink-name-trigger">
                        {drink.name}
                        <span className="sr-only">: ver detalles</span>
                      </button>
                    </DrinkDetailsDialog>
                  </h2>
                  {drink.description ? <p>{drink.description}</p> : null}
                </div>
                <p className="drink-price">{formatDrinkPrice(drink.priceCents)}</p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
