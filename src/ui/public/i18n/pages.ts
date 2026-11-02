import type { PublicLocale } from "./messages";

const conceptEs = {
  metaTitle: "Concepto · Clandestino",
  eyebrow: "CLANDESTINO SUPPER CLAN",
  title: "¿Qué es Clandestino?",
  logoAlt: "Logotipo de Clandestino",
  paragraph:
    "Somos más que una cena y menos que un restaurante. Clandestino Supper Clan es una mesa creada por cuatro amigos que creen en la cocina honesta y en el poder de compartirla. Cocinamos desde lo personal, sin pretensión, para crear noches espontáneas destinadas a reunir a las personas alrededor de una mesa.",
  backHome: "Volver al inicio",
  instagram: "Instagram",
};

export type ConceptMessages = typeof conceptEs;

const conceptEn: ConceptMessages = {
  metaTitle: "Concept · Clandestino",
  eyebrow: "CLANDESTINO SUPPER CLAN",
  title: "What is Clandestino?",
  logoAlt: "Clandestino logo",
  paragraph:
    "We are more than a dinner and less than a restaurant. Clandestino Supper Clan is a table created by four friends who believe in honest cooking and the power of sharing it. We cook from a personal place, without pretense, to create spontaneous evenings meant to bring people together around a table.",
  backHome: "Back to home",
  instagram: "Instagram",
};

export const conceptMessages: Record<PublicLocale, ConceptMessages> = {
  es: conceptEs,
  en: conceptEn,
};

const drinksEs = {
  metaTitle: "Bebidas · Clandestino",
  eyebrow: "CLANDESTINO SUPPER CLAN",
  title: "Bebidas",
  empty: "El menú de bebidas estará disponible pronto.",
  viewDetailsSr: ": ver detalles",
};

export type DrinksMessages = typeof drinksEs;

const drinksEn: DrinksMessages = {
  metaTitle: "Drinks · Clandestino",
  eyebrow: "CLANDESTINO SUPPER CLAN",
  title: "Drinks",
  empty: "The drinks menu will be available soon.",
  viewDetailsSr: ": view details",
};

export const drinksMessages: Record<PublicLocale, DrinksMessages> = {
  es: drinksEs,
  en: drinksEn,
};

const cluesEs = {
  metaTitle: "Pistas · Clandestino",
  eyebrow: "CLANDESTINO SUPPER CLAN",
  title: "Pistas",
  notStarted: "Las pistas aparecerán aquí cuando comience la experiencia.",
  empty: "Todavía no hay pistas. Mantente atento.",
  clueLabel: (number: number) => `PISTA ${number}`,
  imagesAriaLabel: (number: number) => `Imágenes de la pista ${number}`,
  imageAlt: (imageIndex: number, clueNumber: number) =>
    `Imagen ${imageIndex} adjunta a la pista ${clueNumber}`,
};

export type CluesMessages = typeof cluesEs;

const cluesEn: CluesMessages = {
  metaTitle: "Clues · Clandestino",
  eyebrow: "CLANDESTINO SUPPER CLAN",
  title: "Clues",
  notStarted: "Clues will appear here once the experience begins.",
  empty: "There are no clues yet. Stay tuned.",
  clueLabel: (number: number) => `CLUE ${number}`,
  imagesAriaLabel: (number: number) => `Images for clue ${number}`,
  imageAlt: (imageIndex: number, clueNumber: number) =>
    `Image ${imageIndex} attached to clue ${clueNumber}`,
};

export const cluesMessages: Record<PublicLocale, CluesMessages> = {
  es: cluesEs,
  en: cluesEn,
};

const legalEs = {
  lastUpdated: "Última actualización",
  termsTitle: "Términos",
  termsMetaTitle: "Términos | Clandestino",
  termsUpdatedAt: "1 de noviembre de 2026",
  privacyTitle: "Política de privacidad",
  privacyMetaTitle: "Política de privacidad | Clandestino",
  privacyUpdatedAt: "1 de noviembre de 2026",
  prevalenceNotice:
    "This English version is provided for convenience. The Spanish version prevails.",
};

export type LegalMessages = typeof legalEs;

const legalEn: LegalMessages = {
  lastUpdated: "Last updated",
  termsTitle: "Terms",
  termsMetaTitle: "Terms | Clandestino",
  termsUpdatedAt: "November 1, 2026",
  privacyTitle: "Privacy Policy",
  privacyMetaTitle: "Privacy Policy | Clandestino",
  privacyUpdatedAt: "November 1, 2026",
  prevalenceNotice:
    "This English version is provided for convenience. The Spanish version prevails.",
};

export const legalMessages: Record<PublicLocale, LegalMessages> = {
  es: legalEs,
  en: legalEn,
};
