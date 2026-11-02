export interface ExtraItem {
  id: string;
  name: string;
  priceCents: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtraDetails {
  name: string;
  priceCents: number;
  isActive: boolean;
  sortOrder: number;
}

export interface PickerItem {
  id: string;
  name: string;
  priceCents: number;
}

export interface ExtraRepository {
  create(input: ExtraDetails & { actorId: string }): Promise<ExtraItem>;
  update(input: ExtraDetails & { id: string; actorId: string }): Promise<ExtraItem | null>;
  delete(id: string, actorId: string): Promise<boolean>;
  get(id: string): Promise<ExtraItem | null>;
  listForAdmin(): Promise<ExtraItem[]>;
  listActive(): Promise<PickerItem[]>;
}
