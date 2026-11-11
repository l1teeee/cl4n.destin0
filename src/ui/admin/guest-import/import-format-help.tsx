"use client";

import { Braces, FileSpreadsheet, FileText } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/primitives/table";

import { exampleCsv, exampleJson } from "./import-examples";

interface RecognizedColumn {
  label: string;
  titles: string[];
  required: boolean;
  note?: string;
}

const RECOGNIZED_COLUMNS: RecognizedColumn[] = [
  { label: "Nombre", titles: ["nombre"], required: true },
  { label: "Instagram", titles: ["instagram", "usuario", "@"], required: true },
  {
    label: "Marca temporal",
    titles: ["Marca temporal", "Timestamp"],
    required: false,
    note: "Sin ella se usa el orden del archivo.",
  },
  {
    label: "Acompañantes",
    titles: ["acompañante 1", "acompañante 2", "pareja", "persona 2", "invitado 2"],
    required: false,
    note: "Un par de columnas por persona, por ejemplo 'Nombre del acompañante 2' e 'Instagram del acompañante 2'.",
  },
  { label: "Alergias", titles: ["alergia"], required: false },
  { label: "Notas", titles: ["nota", "comentario", "observación"], required: false },
];

function downloadExample(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadCsvExample() {
  downloadExample(`﻿${exampleCsv()}`, "ejemplo-respuestas.csv", "text/csv;charset=utf-8");
}

function downloadJsonExample() {
  downloadExample(exampleJson(), "ejemplo-respuestas.json", "application/json");
}

function FormatCard({
  icon,
  title,
  badge,
  children,
}: {
  icon: ReactNode;
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4 text-sm">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="font-semibold">{title}</h3>
        {badge ? <Badge variant="confirmed">{badge}</Badge> : null}
      </div>
      {children}
    </div>
  );
}

function StepList({ steps }: { steps: string[] }) {
  return (
    <ol className="admin-muted list-decimal space-y-1 pl-5">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

function FormatHelpContent() {
  return (
    <div className="space-y-6">
      <h2 className="admin-section-title">¿Qué archivo necesito?</h2>

      <div className="grid gap-4 md:grid-cols-3">
        <FormatCard
          icon={<FileText className="size-5" aria-hidden="true" />}
          title="CSV de Google Forms"
          badge="Recomendado"
        >
          <StepList
            steps={[
              "Abre el formulario en Google Forms y ve a Respuestas.",
              "Toca el menú ⋮ y elige Descargar respuestas (.csv).",
              "Si llega en .zip, descomprímelo y sube el .csv tal como viene.",
            ]}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-auto min-h-11"
            onClick={downloadCsvExample}
          >
            Descargar ejemplo CSV
          </Button>
        </FormatCard>

        <FormatCard
          icon={<FileSpreadsheet className="size-5" aria-hidden="true" />}
          title="Excel de Google Sheets"
        >
          <StepList
            steps={[
              "Abre la hoja de respuestas vinculada al formulario.",
              "Archivo > Descargar > Microsoft Excel (.xlsx).",
              "Se lee la primera hoja; la primera fila son los títulos.",
            ]}
          />
          <p className="admin-muted">Ábrelo en Excel o Sheets para ver las columnas.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-auto min-h-11"
            onClick={downloadCsvExample}
          >
            Descargar ejemplo CSV
          </Button>
        </FormatCard>

        <FormatCard icon={<Braces className="size-5" aria-hidden="true" />} title="JSON">
          <p className="admin-muted">
            Una lista de respuestas; cada respuesta usa los títulos de columna como claves.
          </p>
          <details>
            <summary className="min-h-11 cursor-pointer py-3">Ver ejemplo</summary>
            <pre className="overflow-x-auto rounded-md border border-border p-4 text-xs">
              {exampleJson()}
            </pre>
          </details>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-auto min-h-11"
            onClick={downloadJsonExample}
          >
            Descargar ejemplo JSON
          </Button>
        </FormatCard>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold">Columnas que reconocemos</h3>
        <div className="max-w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dato</TableHead>
                <TableHead>Títulos que reconocemos</TableHead>
                <TableHead>Obligatorio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {RECOGNIZED_COLUMNS.map((column) => (
                <TableRow key={column.label}>
                  <TableCell>{column.label}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {column.titles.map((title) => (
                        <span key={title} className="rounded-full border px-2 text-xs">
                          {title}
                        </span>
                      ))}
                    </div>
                    {column.note ? <p className="admin-muted mt-1 text-xs">{column.note}</p> : null}
                  </TableCell>
                  <TableCell>{column.required ? "Sí" : "No"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="admin-muted text-sm">
          En alergias, vacío, No, Ninguna o - significan sin alergias. Si un título no se reconoce,
          elígelo en el paso Columnas.
        </p>
      </div>
    </div>
  );
}

export function ImportFormatHelp({ collapsed }: { collapsed: boolean }) {
  if (!collapsed) {
    return (
      <section className="admin-section">
        <FormatHelpContent />
      </section>
    );
  }
  return (
    <section className="admin-section">
      <details>
        <summary className="min-h-11 cursor-pointer py-3 font-semibold">
          ¿Qué formato necesito?
        </summary>
        <div className="pt-4">
          <FormatHelpContent />
        </div>
      </details>
    </section>
  );
}
