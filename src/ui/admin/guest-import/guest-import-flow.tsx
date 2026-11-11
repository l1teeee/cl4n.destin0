"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  IMPORT_FIELDS,
  IMPORT_FIELD_LABELS,
  companionLabel,
  type ColumnMapping,
  type CompanionMapping,
  type ImportErrorResponse,
  type ImportField,
  type ImportPreviewResponse,
  type ImportPreviewRow,
  type ImportRowOutcome,
  type ImportRunResponse,
} from "@/contracts/guest-import";
import { StatGrid } from "@/ui/admin/stat-grid";
import { formatAdminDate } from "@/ui/admin/view-model";
import { cn } from "@/ui/cn";
import { Alert } from "@/ui/primitives/alert";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Label } from "@/ui/primitives/label";
import { SegmentedControl, SegmentedControlItem } from "@/ui/primitives/segmented-control";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/primitives/table";

import { ImportDropzone } from "./import-dropzone";
import { ImportFormatHelp } from "./import-format-help";
import { ImportSteps } from "./import-steps";

const selectClassName =
  "block min-h-11 w-full min-w-0 rounded-none border border-input bg-transparent px-[0.8rem] py-[0.65rem] text-sm text-foreground transition-[border-color,background-color] duration-200 placeholder:text-muted-foreground disabled:opacity-50 read-only:opacity-50 focus:border-primary/50 focus-visible:outline-none aria-invalid:border-destructive aria-invalid:focus:border-destructive [@media(hover:hover)_and_(pointer:fine)]:aria-invalid:hover:border-destructive [@media(hover:hover)_and_(pointer:fine)]:hover:not-focus:border-[#b9b7b0]";

function formatInstagramHandle(handle: string): string {
  if (!handle) return "-";
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function formatGuest(guest: ImportPreviewRow["guests"][number]): string {
  return `${guest.name || "-"} (${formatInstagramHandle(guest.instagram)})`;
}

function formatCompanions(row: ImportPreviewRow): string {
  const companions = row.guests.slice(1);
  return companions.length > 0 ? companions.map(formatGuest).join(", ") : "-";
}

function formatRowGuests(rows: ImportPreviewRow[] | undefined, rowNumber: number): string {
  const row = rows?.find((candidate) => candidate.rowNumber === rowNumber);
  return row ? row.guests.map(formatGuest).join(", ") : "-";
}

const REQUIRED_FIELDS: readonly ImportField[] = ["guest1Name", "guest1Instagram"];

type RowFilter = "all" | "errors";

function formatOutcomeText(outcome: ImportRowOutcome): string {
  if (outcome.result === "RECEIVED") {
    return `Por revisar, #${outcome.reservationNumber}`;
  }
  if (outcome.result === "WAITLISTED") {
    return `Cola, posición ${outcome.waitlistPosition}`;
  }
  return outcome.message;
}

function OutcomeBadge({ outcome }: { outcome: ImportRowOutcome }) {
  if (outcome.result === "RECEIVED") {
    return <Badge variant="confirmed">{formatOutcomeText(outcome)}</Badge>;
  }
  if (outcome.result === "WAITLISTED") {
    return <Badge variant="waitlist">{formatOutcomeText(outcome)}</Badge>;
  }
  return <span className="text-destructive">{formatOutcomeText(outcome)}</span>;
}

function fieldValue(row: ImportPreviewRow, field: ImportField): string | null {
  if (field === "timestamp") return row.timestamp;
  if (field === "guest1Name") return row.guests[0]?.name || null;
  if (field === "guest1Instagram") return row.guests[0]?.instagram || null;
  if (field === "allergies") return row.allergies;
  return row.notes;
}

function exampleValue(rows: ImportPreviewRow[], field: ImportField): string | null {
  for (const row of rows) {
    const value = fieldValue(row, field);
    if (value) return value;
  }
  return null;
}

function companionExample(
  rows: ImportPreviewRow[],
  position: number,
  part: keyof CompanionMapping,
): string | null {
  for (const row of rows) {
    const guest = row.guests[position];
    const value = part === "name" ? guest?.name : guest?.instagram;
    if (value) return value;
  }
  return null;
}

function MappingCard({
  id,
  label,
  headers,
  selectedIndex,
  required,
  example,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  headers: string[];
  selectedIndex: number | undefined;
  required: boolean;
  example: string | null;
  disabled: boolean;
  onChange: (rawValue: string) => void;
}) {
  const isMissing = required && selectedIndex === undefined;
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border border-border p-4",
        isMissing && "border-destructive",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {required ? <Badge>Obligatorio</Badge> : null}
      </div>
      <select
        id={id}
        className={selectClassName}
        value={selectedIndex !== undefined ? String(selectedIndex) : ""}
        disabled={disabled}
        aria-invalid={isMissing}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" className="bg-background text-foreground">
          Sin columna
        </option>
        {headers.map((header, index) => (
          <option
            key={`${index}-${header}`}
            value={String(index)}
            className="bg-background text-foreground"
          >
            {header}
          </option>
        ))}
      </select>
      {isMissing ? <p className="text-sm text-destructive">Elige la columna de {label}.</p> : null}
      {example ? <p className="admin-muted truncate text-sm">Ejemplo: {example}</p> : null}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
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
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");

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
    setRowFilter("all");
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

  async function applyMapping(nextMapping: ColumnMapping) {
    if (!file) return;
    setMapping(nextMapping);
    setImportId(crypto.randomUUID());
    await requestPreview(file, nextMapping);
  }

  async function handleMappingChange(field: ImportField, rawValue: string) {
    const nextMapping: ColumnMapping = { ...mapping };
    if (rawValue === "") {
      delete nextMapping[field];
    } else {
      nextMapping[field] = Number(rawValue);
    }
    await applyMapping(nextMapping);
  }

  async function handleCompanionChange(
    index: number,
    part: keyof CompanionMapping,
    rawValue: string,
  ) {
    const nextCompanions = companions.map((pair) => ({ ...pair }));
    if (rawValue === "") {
      delete nextCompanions[index]![part];
    } else {
      nextCompanions[index]![part] = Number(rawValue);
    }
    await applyMapping({ ...mapping, companions: nextCompanions });
  }

  function handleAddCompanion() {
    setMapping({ ...mapping, companions: [...companions, {}] });
  }

  async function handleRemoveCompanion() {
    await applyMapping({ ...mapping, companions: companions.slice(0, -1) });
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

  const companions = mapping.companions ?? [];
  const canAddCompanion = preview ? companions.length < preview.maxPartySize - 1 : false;
  const missingRequired = preview
    ? REQUIRED_FIELDS.some((field) => mapping[field] === undefined)
    : false;
  const currentStep = result ? 4 : !preview ? 1 : missingRequired ? 2 : 3;
  const visibleRows = preview
    ? rowFilter === "errors"
      ? preview.rows.filter((row) => row.error)
      : preview.rows
    : [];

  async function handleFileChosen(selected: File) {
    setFile(selected);
    await requestPreview(selected);
  }

  return (
    <div className="space-y-8">
      <section className="admin-section space-y-6">
        <ImportSteps current={currentStep} />

        {error ? (
          <Alert variant="destructive" role="alert">
            {error}
          </Alert>
        ) : null}

        {pending === "preview" ? (
          <p className="flex items-center gap-2 text-sm" aria-live="polite">
            <Loader2
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Leyendo archivo...
          </p>
        ) : null}

        {step === "upload" ? (
          <div className="space-y-4">
            <h2 ref={headingRef} tabIndex={-1} className="admin-section-title">
              Archivo de respuestas
            </h2>
            <ImportDropzone
              disabled={pending !== null}
              onFile={(selected) => {
                void handleFileChosen(selected);
              }}
              onReject={setError}
            />
          </div>
        ) : null}

        {step === "preview" && file ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="min-w-0 truncate font-semibold">{file.name}</span>
            <span className="admin-muted">{formatFileSize(file.size)}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              disabled={pending !== null}
              onClick={resetAll}
            >
              Cambiar archivo
            </Button>
          </div>
        ) : null}

        {step === "preview" && preview ? (
          <div className="space-y-6">
            <h2 ref={headingRef} tabIndex={-1} className="admin-section-title">
              Columnas
            </h2>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((field) => (
                <MappingCard
                  key={field}
                  id={`mapping-${field}`}
                  label={IMPORT_FIELD_LABELS[field]}
                  headers={preview.headers}
                  selectedIndex={mapping[field]}
                  required={REQUIRED_FIELDS.includes(field)}
                  example={mapping[field] !== undefined ? exampleValue(preview.rows, field) : null}
                  disabled={pending !== null}
                  onChange={(rawValue) => {
                    void handleMappingChange(field, rawValue);
                  }}
                />
              ))}
              {companions.flatMap((pair, index) =>
                (["name", "instagram"] as const).map((part) => (
                  <MappingCard
                    key={`companion-${index}-${part}`}
                    id={`mapping-companion-${index}-${part}`}
                    label={companionLabel(index + 1, part)}
                    headers={preview.headers}
                    selectedIndex={pair[part]}
                    required={false}
                    example={
                      pair[part] !== undefined
                        ? companionExample(preview.rows, index + 1, part)
                        : null
                    }
                    disabled={pending !== null}
                    onChange={(rawValue) => {
                      void handleCompanionChange(index, part, rawValue);
                    }}
                  />
                )),
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={pending !== null || !canAddCompanion}
                onClick={handleAddCompanion}
              >
                Agregar acompañante
              </Button>
              {companions.length > 0 ? (
                <Button
                  type="button"
                  variant="link"
                  className="min-h-11 text-sm underline"
                  disabled={pending !== null}
                  onClick={() => {
                    void handleRemoveCompanion();
                  }}
                >
                  Quitar
                </Button>
              ) : null}
            </div>

            {!missingRequired ? (
              <div className="space-y-6">
                <h2 className="admin-section-title">Revisión</h2>

                <StatGrid
                  items={[
                    { label: "Listas para importar", value: preview.summary.valid },
                    { label: "Con errores", value: preview.summary.invalid },
                    { label: "Lugares disponibles", value: preview.summary.availableSeats },
                    { label: "Espacio en la cola", value: preview.summary.waitlistAvailable },
                  ]}
                />

                <p className="admin-muted text-sm">
                  Se importan en orden de marca temporal: primero ocupan lugares y luego pasan a la
                  cola. Si llegan solicitudes del formulario público al mismo tiempo, el resultado
                  puede variar.
                </p>

                <SegmentedControl
                  value={rowFilter}
                  onValueChange={(value) => setRowFilter(value as RowFilter)}
                  aria-label="Filtrar filas"
                >
                  <SegmentedControlItem value="all" className="min-h-11">
                    Todas
                  </SegmentedControlItem>
                  <SegmentedControlItem value="errors" className="min-h-11">
                    Con errores
                  </SegmentedControlItem>
                </SegmentedControl>

                <div className="max-w-full overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Orden</TableHead>
                        <TableHead>Fila</TableHead>
                        <TableHead>Marca temporal</TableHead>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Instagram</TableHead>
                        <TableHead>Acompañantes</TableHead>
                        <TableHead>Alergias</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleRows.map((row) => (
                        <TableRow key={row.rowNumber}>
                          <TableCell>{row.order ?? "-"}</TableCell>
                          <TableCell>{row.rowNumber}</TableCell>
                          <TableCell>
                            {row.timestamp ? formatAdminDate(new Date(row.timestamp)) : "-"}
                          </TableCell>
                          <TableCell>{row.guests[0]?.name || "-"}</TableCell>
                          <TableCell>
                            {formatInstagramHandle(row.guests[0]?.instagram ?? "")}
                          </TableCell>
                          <TableCell>{formatCompanions(row)}</TableCell>
                          <TableCell>{row.allergies ?? "-"}</TableCell>
                          <TableCell>
                            {row.error ? (
                              <span className="text-destructive">{row.error}</span>
                            ) : (
                              <Badge variant="confirmed">Lista</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="sticky bottom-0 flex flex-wrap gap-3 border-t border-border bg-background/95 py-3">
                  <Button
                    type="button"
                    className="min-h-11"
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
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={pending !== null}
                    onClick={resetAll}
                  >
                    Elegir otro archivo
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "result" && result ? (
          <div className="space-y-6">
            <h2 ref={headingRef} tabIndex={-1} className="admin-section-title">
              Resultado
            </h2>

            <StatGrid
              items={[
                { label: "En Por revisar", value: result.summary.received },
                { label: "En la cola", value: result.summary.waitlisted },
                { label: "Sin importar", value: result.summary.skipped },
              ]}
            />

            <div className="max-w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fila</TableHead>
                    <TableHead>Personas</TableHead>
                    <TableHead>Resultado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.outcomes.map((outcome) => (
                    <TableRow key={outcome.rowNumber}>
                      <TableCell>{outcome.rowNumber}</TableCell>
                      <TableCell>{formatRowGuests(preview?.rows, outcome.rowNumber)}</TableCell>
                      <TableCell>
                        <OutcomeBadge outcome={outcome} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild className="min-h-11">
                <Link href={`/admin/events/${eventId}`}>Ver la experiencia</Link>
              </Button>
              <Button type="button" variant="outline" className="min-h-11" onClick={resetAll}>
                Importar otro archivo
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <ImportFormatHelp collapsed={step !== "upload"} />
    </div>
  );
}
