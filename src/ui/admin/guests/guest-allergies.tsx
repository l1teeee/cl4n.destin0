import { Badge } from "@/ui/primitives/badge";

// Allergies are safety information for the kitchen, so they use the alert color instead of the
// regular text color used by every other cell.
export function GuestAllergies({ allergies }: { allergies: string | null }) {
  if (allergies === null) return <span>No</span>;

  return (
    <span className="flex flex-col items-start gap-1">
      <Badge variant="rejected">Alergias</Badge>
      <span className="font-semibold break-words whitespace-pre-line text-destructive">
        {allergies}
      </span>
    </span>
  );
}
