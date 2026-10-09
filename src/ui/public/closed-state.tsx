import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";

import type { ClosedStateVariant } from "./home-view-model";
import { PublicLanding } from "./public-landing";

interface ClosedStateProps {
  variant: ClosedStateVariant;
}

function closedStateCopy(variant: ClosedStateVariant): string {
  switch (variant.state) {
    case "SCHEDULED":
      return `La próxima experiencia ya tiene fecha. Las solicitudes abren el ${formatPublicEventDate(variant.opensAt)}`;
    case "FULL":
      return "Los cupos para esta experiencia se agotaron.";
    case "CLOSED":
      return "Las solicitudes para esta experiencia ya cerraron.";
    case "DEFAULT":
      return "Todavía no hay fecha. Cuando la haya, lo sabrás.";
  }
}

export function ClosedState({ variant }: ClosedStateProps) {
  return (
    <PublicLanding status="EL CLAN ESTÁ CERRADO">
      <p>{closedStateCopy(variant)}</p>
    </PublicLanding>
  );
}
