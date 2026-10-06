interface ClosedStateProps {
  soldOut?: boolean;
}

export function ClosedState({ soldOut = false }: ClosedStateProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-[0.2em]">CLANDESTINO</h1>
      <h2 className="text-xl font-medium">EL CLAN ESTÁ CERRADO</h2>
      <p>
        {soldOut
          ? "Los cupos para esta experiencia se agotaron."
          : "Todavía no hay fecha. Cuando la haya, lo sabrás."}
      </p>
    </main>
  );
}
