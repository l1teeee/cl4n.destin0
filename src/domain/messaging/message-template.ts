import { TEMPLATE_VARIABLES, type TemplateKey } from "./message-types";

const placeholderPattern = /\{([^{}]+)\}/g;

export function findUnknownVariables(key: TemplateKey, body: string): string[] {
  const allowed = new Set(TEMPLATE_VARIABLES[key]);
  const unknown = new Set<string>();

  for (const match of body.matchAll(placeholderPattern)) {
    const variable = match[1]!;
    if (!allowed.has(variable)) {
      unknown.add(variable);
    }
  }

  return [...unknown];
}

export function renderMessageTemplate(body: string, values: Record<string, string>): string {
  return body
    .replace(placeholderPattern, (_, variable: string) => values[variable] ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
