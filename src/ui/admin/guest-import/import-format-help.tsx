"use client";

import { Button } from "@/ui/primitives/button";

import { exampleCsv, exampleJson } from "./import-examples";

function downloadExample(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportFormatHelp() {
  return (
    <section className="admin-section space-y-4">
      <h2 className="admin-section-title">Formatos aceptados</h2>

      <div className="space-y-3 text-sm">
        <div className="space-y-1">
          <h3 className="font-semibold">CSV de Google Forms</h3>
          <p className="admin-muted">
            En Google Forms abre Respuestas, menú ⋮, Descargar respuestas (.csv). Si llega en .zip,
            descomprímelo y sube el .csv tal como viene.
          </p>
        </div>

        <div className="space-y-1">
          <h3 className="font-semibold">Excel de Google Sheets</h3>
          <p className="admin-muted">
            En la hoja de respuestas: Archivo &gt; Descargar &gt; Microsoft Excel (.xlsx). Se lee la
            primera hoja y la primera fila son los títulos.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">JSON</h3>
          <p className="admin-muted">
            Una lista de respuestas. Cada respuesta es un objeto cuyas claves son los títulos de las
            columnas, igual que en el CSV.
          </p>
          <pre className="overflow-x-auto rounded-md border border-border p-4 text-xs">
            {exampleJson()}
          </pre>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <h3 className="font-semibold">Columnas que se reconocen solas</h3>
        <dl className="grid gap-2">
          <div>
            <dt className="font-semibold">Marca temporal</dt>
            <dd className="admin-muted">
              &quot;Marca temporal&quot; o &quot;Timestamp&quot; (opcional; sin ella se usa el orden
              del archivo).
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Nombre</dt>
            <dd className="admin-muted">un título con &quot;nombre&quot;.</dd>
          </div>
          <div>
            <dt className="font-semibold">Instagram</dt>
            <dd className="admin-muted">
              un título con &quot;instagram&quot;, &quot;usuario&quot; o &quot;@&quot;.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Acompañante</dt>
            <dd className="admin-muted">
              un título con &quot;acompañante&quot;, &quot;pareja&quot;, &quot;invitado 2&quot;,
              &quot;persona 2&quot; o &quot;segunda persona&quot; junto con &quot;nombre&quot; o
              &quot;instagram&quot;.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Alergias</dt>
            <dd className="admin-muted">un título con &quot;alergia&quot;.</dd>
          </div>
          <div>
            <dt className="font-semibold">Notas</dt>
            <dd className="admin-muted">
              un título con &quot;nota&quot;, &quot;comentario&quot; u &quot;observación&quot;.
            </dd>
          </div>
        </dl>
      </div>

      <p className="admin-muted text-sm">
        Nombre e Instagram son obligatorios. En alergias, vacío, &quot;No&quot;, &quot;Ninguna&quot;
        o &quot;-&quot; significa sin alergias. Si un título no se reconoce, elige la columna a mano
        en la vista previa. Máximo 1 MB y 200 respuestas por archivo.
      </p>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            downloadExample(
              `\uFEFF${exampleCsv()}`,
              "ejemplo-respuestas.csv",
              "text/csv;charset=utf-8",
            )
          }
        >
          Descargar ejemplo CSV
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            downloadExample(exampleJson(), "ejemplo-respuestas.json", "application/json")
          }
        >
          Descargar ejemplo JSON
        </Button>
      </div>
    </section>
  );
}
