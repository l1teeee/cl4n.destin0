"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body>
        <main>
          <h1>Ocurrio un error inesperado.</h1>
          <p>Intenta de nuevo.</p>
        </main>
      </body>
    </html>
  );
}
