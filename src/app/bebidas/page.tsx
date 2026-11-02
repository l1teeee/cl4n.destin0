import type { CSSProperties } from "react";
import type { Metadata } from "next";

import { formatDrinkPrice } from "@/domain/drink/drink-price";
import { postgresDrinkRepository } from "@/infrastructure/db/repositories/postgres-drink-repository";
import { DrinkDetailsDialog } from "@/ui/drink-details-dialog";
import { DrinkImage } from "@/ui/public/drink-image";
import { getPublicLocale } from "@/ui/public/i18n/locale";
import { drinksMessages } from "@/ui/public/i18n/pages";
import { PublicHeader } from "@/ui/public/public-header";

import "./bebidas.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getPublicLocale();
  return { title: drinksMessages[locale].metaTitle };
}

export default async function DrinksMenuPage() {
  const locale = await getPublicLocale();
  const messages = drinksMessages[locale];
  const drinks = await postgresDrinkRepository.listVisible();

  return (
    <div className="public-page">
      <PublicHeader aboutHref="/" />
      <main className="drinks-page">
        <header className="drinks-intro">
          <p className="public-eyebrow">{messages.eyebrow}</p>
          <h1>{messages.title}</h1>
        </header>
        {drinks.length === 0 ? (
          <p>{messages.empty}</p>
        ) : (
          <ul className="drinks-list">
            {drinks.map((drink, index) => (
              <li
                key={drink.id}
                className="drink-item"
                style={{ "--drink-index": index } as CSSProperties}
              >
                {drink.imageId ? (
                  <DrinkImage src={`/bebidas/imagen/${drink.imageId}`} alt={drink.name} />
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
                        <span className="sr-only">{messages.viewDetailsSr}</span>
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
