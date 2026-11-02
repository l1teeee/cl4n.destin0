import { cookies } from "next/headers";

import type { PublicLocale } from "./messages";

export async function getPublicLocale(): Promise<PublicLocale> {
  const value = (await cookies()).get("cl4n_lang")?.value;
  return value === "en" ? "en" : "es";
}
