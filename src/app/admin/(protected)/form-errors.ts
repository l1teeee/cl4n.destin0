import type { z } from "zod";

export function fieldErrorsFromZod(error: z.ZodError): Partial<Record<string, string>> {
  const fieldErrors: Partial<Record<string, string>> = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === undefined) continue;

    const fieldName = String(field);
    fieldErrors[fieldName] ??= issue.message;
  }

  return fieldErrors;
}
