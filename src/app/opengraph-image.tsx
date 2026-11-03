import { ImageResponse } from "next/og";
import { OgCard } from "@/ui/public/og/og-card";
import { getOgFonts } from "@/ui/public/og/og-fonts";

export const alt = "El clan está abierto · Clandestino";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(<OgCard dateLine={null} footer="Experiencias privadas" />, {
    ...size,
    fonts: await getOgFonts(),
  });
}
