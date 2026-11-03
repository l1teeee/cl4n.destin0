export interface RecipientPerson {
  slot: 1 | 2;
  name: string;
  instagram: string | null;
  linked: boolean;
  statusByItem: Record<string, "NOT_SENT" | "SENT" | "PENDING" | "FAILED">;
}

export interface RecipientGroup {
  reservationId: string;
  reservationNumber: number;
  people: RecipientPerson[];
}
