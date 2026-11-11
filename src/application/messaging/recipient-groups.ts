export interface RecipientPerson {
  slot: number;
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
