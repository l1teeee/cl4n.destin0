import type { PublicLocale } from "./messages";

const conceptEs = {
  metaTitle: "Concepto",
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
  metaTitle: "Concept",
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
  metaTitle: "Bebidas",
  eyebrow: "CLANDESTINO SUPPER CLAN",
  title: "Bebidas",
  empty: "El menú de bebidas estará disponible pronto.",
  viewDetailsSr: ": ver detalles",
};

export type DrinksMessages = typeof drinksEs;

const drinksEn: DrinksMessages = {
  metaTitle: "Drinks",
  eyebrow: "CLANDESTINO SUPPER CLAN",
  title: "Drinks",
  empty: "The drinks menu will be available soon.",
  viewDetailsSr: ": view details",
};

export const drinksMessages: Record<PublicLocale, DrinksMessages> = {
  es: drinksEs,
  en: drinksEn,
};

const legalEs = {
  lastUpdated: "Última actualización",
  termsTitle: "Términos",
  termsMetaTitle: "Términos",
  termsUpdatedAt: "1 de noviembre de 2026",
  privacyTitle: "Política de privacidad",
  privacyMetaTitle: "Política de privacidad",
  privacyUpdatedAt: "1 de noviembre de 2026",
  prevalenceNotice:
    "This English version is provided for convenience. The Spanish version prevails.",
};

export type LegalMessages = typeof legalEs;

const legalEn: LegalMessages = {
  lastUpdated: "Last updated",
  termsTitle: "Terms",
  termsMetaTitle: "Terms",
  termsUpdatedAt: "November 1, 2026",
  privacyTitle: "Privacy Policy",
  privacyMetaTitle: "Privacy Policy",
  privacyUpdatedAt: "November 1, 2026",
  prevalenceNotice:
    "This English version is provided for convenience. The Spanish version prevails.",
};

export const legalMessages: Record<PublicLocale, LegalMessages> = {
  es: legalEs,
  en: legalEn,
};
