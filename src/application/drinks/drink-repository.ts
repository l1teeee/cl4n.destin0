import type { ImageContentType } from "@/contracts/image-upload";

export interface DrinkItem {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  isVisible: boolean;
  imageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicDrink {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  imageId: string | null;
}

export interface DrinkImageFile {
  contentType: ImageContentType;
  data: Uint8Array;
}

export interface StoredDrinkImage extends DrinkImageFile {
  id: string;
}

export type DrinkImageChange =
  { kind: "keep" } | { kind: "replace"; image: DrinkImageFile } | { kind: "remove" };

export interface DrinkDetails {
  name: string;
  description: string | null;
  priceCents: number;
  isVisible: boolean;
}

export interface DrinkRepository {
  create(
    input: DrinkDetails & { image: DrinkImageFile | null; actorId: string },
  ): Promise<DrinkItem>;
  update(
    input: DrinkDetails & { id: string; image: DrinkImageChange; actorId: string },
  ): Promise<DrinkItem | null>;
  delete(id: string, actorId: string): Promise<boolean>;
  get(id: string): Promise<DrinkItem | null>;
  listForAdmin(): Promise<DrinkItem[]>;
  listVisible(): Promise<PublicDrink[]>;
  getImage(imageId: string): Promise<StoredDrinkImage | null>;
}
