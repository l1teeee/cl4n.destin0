import { PublicLanding } from "./public-landing";

interface ClosedStateProps {
  soldOut?: boolean;
}

export function ClosedState({ soldOut = false }: ClosedStateProps) {
  return (
    <PublicLanding status="EL CLAN ESTÁ CERRADO">
      <p>
        {soldOut
          ? "Los cupos para esta experiencia se agotaron."
          : "Todavía no hay fecha. Cuando la haya, lo sabrás."}
      </p>
    </PublicLanding>
  );
}
