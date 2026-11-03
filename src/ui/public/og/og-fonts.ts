import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function getOgFonts() {
  const [regular, semibold] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/FunnelSans-Regular.ttf")),
    readFile(join(process.cwd(), "assets/fonts/FunnelSans-SemiBold.ttf")),
  ]);

  return [
    { name: "Funnel Sans", data: regular, weight: 400 as const },
    { name: "Funnel Sans", data: semibold, weight: 600 as const },
  ];
}
