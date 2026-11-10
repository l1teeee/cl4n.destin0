"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  IMPORT_FIELDS,
  IMPORT_FIELD_LABELS,
  IMPORT_FILE_EXTENSIONS,
  type ColumnMapping,
  type ImportErrorResponse,
  type ImportField,
  type ImportPreviewResponse,
  type ImportPreviewRow,
  type ImportRowOutcome,
  type ImportRunResponse,
} from "@/contracts/guest-import";
import { formatAdminDate } from "@/ui/admin/view-model";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/primitives/table";

const selectClassName =
  "block min-h-11 w-full min-w-0 rounded-none border border-input bg-transparent px-[0.8rem] py-[0.65rem] text-sm text-foreground transition-[border-color,background-color] duration-200 placeholder:text-muted-foreground disabled:opacity-50 read-only:opacity-50 focus:border-primary/50 focus-visible:outline-none aria-invalid:border-destructive aria-invalid:focus:border-destructive [@media(hover:hover)_and_(pointer:fine)]:aria-invalid:hover:border-destructive [@media(hover:hover)_and_(pointer:fine)]:hover:not-focus:border-[#b9b7b0]";

function formatInstagramHandle(handle: string): string {
  if (!handle) return "-";
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function formatCompanion(row: ImportPreviewRow): string {
  const parts = [
    row.guest2Name,
    row.guest2Instagram ? formatInstagramHandle(row.guest2Instagram) : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "-";
}

function formatOutcome(outcome: ImportRowOutcome): string {
  if (outcome.result === "RECEIVED") {
    return `Por revisar, #${outcome.reservationNumber}`;
  }
  if (outcome.result === "WAITLISTED") {
    return `Cola, posición ${outcome.waitlistPosition}`;
  }
  return outcome.message;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as Partial<ImportErrorResponse>;
    if (typeof data.error === "string" && data.error) {
      return data.error;
    }
  } catch {
    // Fallback below when response is not JSON.
  }
  return "No se pudo completar la solicitud.";
}

export function GuestImportFlow({ eventId }: { eventId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [importId, setImportId] = useState<string>("");
  const [result, setResult] = useState<ImportRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"preview" | "run" | null>(null);
  const [retryRun, setRetryRun] = useState(false);

  const step = result ? "result" : preview ? "preview" : "upload";
  const prevStepRef = useRef(step);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (prevStepRef.current !== step) {
      prevStepRef.current = step;
      headingRef.current?.focus();
    }
  }, [step]);

  function resetAll() {
    setFile(null);
    setPreview(null);
    setMapping({});
    setImportId("");
    setResult(null);
    setError(null);
    setPending(null);
    setRetryRun(false);
  }

  async function requestPreview(selectedFile: File, customMapping?: ColumnMapping) {
    setPending("preview");
    setError(null);
    setRetryRun(false);

    const formData = new FormData();
    formData.append("file", selectedFile);
    if (customMapping !== undefined) {
      formData.append("mapping", JSON.stringify(customMapping));
    }

    try {
      const response = await fetch(`/admin/events/${eventId}/importar/preview`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        setError(await readErrorMessage(response));
        return;
      }
      const data = (await response.json()) as ImportPreviewResponse;
      setPreview(data);
      setMapping(data.mapping);
      setImportId(crypto.randomUUID());
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    } finally {
      setPending(null);
    }
  }

  async function handleMappingChange(field: ImportField, rawValue: string) {
    if (!file) return;
    const nextMapping: ColumnMapping = { ...mapping };
    if (rawValue === "") {
      delete nextMapping[field];
    } else {
      nextMapping[field] = Number(rawValue);
    }
    setMapping(nextMapping);
    setImportId(crypto.randomUUID());
    await requestPreview(file, nextMapping);
  }

  async function handleRunImport() {
    if (!file || !preview) return;
    setPending("run");
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("mapping", JSON.stringify(mapping));
    formData.append("importId", importId);

    try {
      const response = await fetch(`/admin/events/${eventId}/importar/run`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        if (response.status >= 500) {
          setRetryRun(true);
        }
        setError(await readErrorMessage(response));
        return;
      }
      const data = (await response.json()) as ImportRunResponse;
      setRetryRun(false);
      setResult(data);
    } catch {
      setRetryRun(true);
      setError("No se pudo conectar. Intenta de nuevo.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="admin-section space-y-6">
      {error ? (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      ) : null}

      {step === "upload" ? (
        <div className="space-y-4">
          <h2 ref={headingRef} tabIndex={-1} className="admin-section-title">
            Archivo de respuestas
          </h2>
          <div className="max-w-md space-y-2">
            <Label htmlFor="import-file-input">Archivo de respuestas</Label>
            <Input
              id="import-file-input"
              type="file"
              accept={IMPORT_FILE_EXTENSIONS.join(",")}
              disabled={pending !== null}
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setFile(selected);
                setError(null);
              }}
            />
          </div>
          <div>
            <Button
              type="button"
              disabled={!file || pending !== null}
              onClick={() => {
                if (file) void requestPreview(file);
              }}
            >
              {pending === "preview" ? "Leyendo..." : "Leer archivo"}
            </Button>
          </div>
        </div>
      ) : null}

      {step === "preview" && preview ? (
        <div className="space-y-6">
          <h2 ref={headingRef} tabIndex={-1} className="admin-section-title">
            Vista previa
          </h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {IMPORT_FIELDS.map((field) => {
              const selectId = `mapping-${field}`;
              const selectedIndex = mapping[field];
              return (
                <div key={field} className="space-y-2">
                  <Label htmlFor={selectId}>{IMPORT_FIELD_LABELS[field]}</Label>
                  <select
                    id={selectId}
                    className={selectClassName}
                    value={selectedIndex !== undefined ? String(selectedIndex) : ""}
                    disabled={pending !== null}
                    onChange={(event) => {
                      void handleMappingChange(field, event.target.value);
                    }}
                  >
                    <option value="" className="bg-background text-foreground">
                      Sin columna
                    </option>
                    {preview.headers.map((header, index) => (
                      <option
                        key={`${index}-${header}`}
                        value={String(index)}
                        className="bg-background text-foreground"
                      >
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <div className="space-y-1 text-sm">
            <p>
              {preview.summary.valid} listas para importar, {preview.summary.invalid} con errores.
              Lugares disponibles: {preview.summary.availableSeats}. Espacio en la cola:{" "}
              {preview.summary.waitlistAvailable}.
            </p>
            <p className="admin-muted">
              El resultado final puede variar si llegan solicitudes del formulario público al mismo
              tiempo.
            </p>
          </div>

          <div className="max-w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Orden</TableHead>
                  <TableHead>Fila</TableHead>
                  <TableHead>Marca temporal</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Instagram</TableHead>
                  <TableHead>Acompañante</TableHead>
                  <TableHead>Alergias</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((row) => (
                  <TableRow key={row.rowNumber}>
                    <TableCell>{row.order ?? "-"}</TableCell>
                    <TableCell>{row.rowNumber}</TableCell>
                    <TableCell>
                      {row.timestamp ? formatAdminDate(new Date(row.timestamp)) : "-"}
                    </TableCell>
                    <TableCell>{row.guest1Name || "-"}</TableCell>
                    <TableCell>{formatInstagramHandle(row.guest1Instagram)}</TableCell>
                    <TableCell>{formatCompanion(row)}</TableCell>
                    <TableCell>{row.allergies ?? "-"}</TableCell>
                    <TableCell>
                      {row.error ? <span className="text-destructive">{row.error}</span> : "Lista"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={preview.summary.valid === 0 || pending !== null}
              onClick={() => {
                void handleRunImport();
              }}
            >
              {pending === "run"
                ? "Importando..."
                : retryRun
                  ? "Reintentar importación"
                  : `Importar ${preview.summary.valid} solicitudes`}
            </Button>
            <Button type="button" variant="outline" disabled={pending !== null} onClick={resetAll}>
              Elegir otro archivo
            </Button>
          </div>
        </div>
      ) : null}

      {step === "result" && result ? (
        <div className="space-y-6">
          <h2 ref={headingRef} tabIndex={-1} className="admin-section-title">
            Resultado de la importación
          </h2>

          <p className="text-sm">
            {result.summary.received} en Por revisar, {result.summary.waitlisted} en la cola,{" "}
            {result.summary.skipped} sin importar.
          </p>

          <div className="max-w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fila</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.outcomes.map((outcome) => (
                  <TableRow key={outcome.rowNumber}>
                    <TableCell>{outcome.rowNumber}</TableCell>
                    <TableCell>{formatOutcome(outcome)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href={`/admin/events/${eventId}`}>Ver la experiencia</Link>
            </Button>
            <Button type="button" variant="outline" onClick={resetAll}>
              Importar otro archivo
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
