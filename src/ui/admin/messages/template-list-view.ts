import type { TemplateKey } from "@/domain/messaging/message-types";

export const TEMPLATE_GROUP_TITLES = [
  "Solicitud y cola",
  "Lista y pago",
  "Ubicación y pistas",
  "Otros",
] as const;

export type TemplateGroupTitle = (typeof TEMPLATE_GROUP_TITLES)[number];

const templateGroups: Partial<Record<TemplateKey, TemplateGroupTitle>> = {
  REQUEST_RECEIVED: "Solicitud y cola",
  WAITLISTED: "Solicitud y cola",
  PROMOTED: "Solicitud y cola",
  REJECTED: "Solicitud y cola",
  ON_LIST: "Lista y pago",
  PAID: "Lista y pago",
  CANCELLED_UNPAID: "Lista y pago",
  CANCELLED_PAID: "Lista y pago",
  REFUNDED: "Lista y pago",
  TAB: "Lista y pago",
  LOCATION: "Ubicación y pistas",
};

export interface TemplateListItem {
  key: TemplateKey;
  title: string;
  timing: string;
  body: string;
  variables: readonly string[];
  editedLabel: string;
  updatedLabel: string;
}

export interface TemplateGroup {
  title: TemplateGroupTitle;
  items: TemplateListItem[];
}

export function normalizeTemplateSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function filterTemplates(
  items: readonly TemplateListItem[],
  query: string,
): TemplateListItem[] {
  const search = normalizeTemplateSearch(query);
  if (search === "") return [...items];

  return items.filter((item) =>
    [item.title, item.timing, item.body].some((text) =>
      normalizeTemplateSearch(text).includes(search),
    ),
  );
}

export function groupTemplates(items: readonly TemplateListItem[]): TemplateGroup[] {
  return TEMPLATE_GROUP_TITLES.map((title) => ({
    title,
    items: items.filter((item) => (templateGroups[item.key] ?? "Otros") === title),
  })).filter((group) => group.items.length > 0);
}

export function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}
