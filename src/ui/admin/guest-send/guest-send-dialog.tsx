"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { Alert } from "@/ui/primitives/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/primitives/alert-dialog";
import { Button } from "@/ui/primitives/button";
import { SegmentedControl, SegmentedControlItem } from "@/ui/primitives/segmented-control";

import {
  groupAccentClass,
  isSendable,
  sendableKeys,
  statusLabel,
  type GuestSendGroup,
  type GuestSendPerson,
  type GuestSendTarget,
} from "./guest-send-model";

type SendMode = "ALL" | "PICK";

interface GuestSendDialogProps {
  triggerLabel: string;
  title: string;
  description: string;
  groups: readonly GuestSendGroup[];
  target: GuestSendTarget;
  sendAll: () => Promise<AdminActionState>;
  sendSelected: (keys: readonly string[]) => Promise<AdminActionState>;
  disabled?: boolean;
}

interface PickBoxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function PickBox({ label, checked, onChange }: PickBoxProps) {
  return (
    <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        className="size-5 cursor-pointer accent-primary"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function PersonStatus({ person }: { person: GuestSendPerson }) {
  if (person.status === undefined) {
    return null;
  }
  return (
    <span
      className={
        person.status === "FAILED" ? "text-xs text-destructive" : "text-xs text-muted-foreground"
      }
    >
      {statusLabel(person.status)}
    </span>
  );
}

export function GuestSendDialog({
  triggerLabel,
  title,
  description,
  groups,
  target,
  sendAll,
  sendSelected,
  disabled = false,
}: GuestSendDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SendMode>("ALL");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const allKeys = sendableKeys(groups, target);
  const allSelected = allKeys.length > 0 && allKeys.every((key) => selected.includes(key));

  function handleOpenChange(next: boolean) {
    if (sending) {
      return;
    }
    setOpen(next);
    if (next) {
      setMode("ALL");
      setSelected([]);
      setError(null);
    }
  }

  function toggleKey(key: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, key] : current.filter((item) => item !== key),
    );
  }

  function toggleAll() {
    setSelected(allSelected ? [] : allKeys);
  }

  async function submit() {
    setSending(true);
    setError(null);
    try {
      const state = mode === "ALL" ? await sendAll() : await sendSelected(selected);
      if (state.ok) {
        setResult(state.message);
        setOpen(false);
      } else {
        setError(state.message);
      }
    } finally {
      setSending(false);
    }
  }

  const count = mode === "ALL" ? allKeys.length : selected.length;
  const summaryLine =
    target === "PERSON"
      ? `Se enviará a ${allKeys.length} personas que aún no lo tienen.`
      : `Se enviará la cuenta de ${allKeys.length} grupos a su titular.`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => handleOpenChange(true)}
        >
          {triggerLabel}
        </Button>
        {result ? (
          <p role="status" className="admin-muted">
            {result}
          </p>
        ) : null}
      </div>
      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent className="max-w-[calc(100vw-1.5rem)] p-4 sm:max-w-lg sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>

          <SegmentedControl
            value={mode}
            onValueChange={(value) => setMode(value as SendMode)}
            aria-label="Modo de envío"
          >
            <SegmentedControlItem value="ALL">A todos</SegmentedControlItem>
            <SegmentedControlItem value="PICK">Elegir</SegmentedControlItem>
          </SegmentedControl>

          {groups.length === 0 ? (
            <p className="admin-muted">No hay invitados para enviar.</p>
          ) : (
            <div className="grid max-h-[60vh] gap-3 overflow-y-auto">
              {mode === "PICK" ? (
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 cursor-pointer accent-primary"
                    checked={allSelected}
                    disabled={allKeys.length === 0}
                    onChange={toggleAll}
                  />
                  Seleccionar todo
                </label>
              ) : null}
              {groups.map((group, index) => {
                const together = group.people.length === 2;
                const groupSendable = isSendable(group.people[0]);
                return (
                  <div
                    key={group.key}
                    className={`rounded-xl border border-border border-l-4 p-3 ${groupAccentClass(index)}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {mode === "PICK" && target === "GROUP" && groupSendable ? (
                        <PickBox
                          label={`Elegir ${group.label}`}
                          checked={selected.includes(group.key)}
                          onChange={(checked) => toggleKey(group.key, checked)}
                        />
                      ) : null}
                      <span className="text-sm font-semibold">{group.label}</span>
                      {together ? (
                        <span className="text-xs text-muted-foreground">Juntos</span>
                      ) : null}
                      {group.detail ? (
                        <span className="ml-auto text-sm">{group.detail}</span>
                      ) : null}
                    </div>
                    <ul className="mt-2 grid gap-1">
                      {group.people.map((person) => (
                        <li
                          key={person.key}
                          className="flex flex-wrap items-center gap-x-2 gap-y-1"
                        >
                          {mode === "PICK" && target === "PERSON" && isSendable(person) ? (
                            <PickBox
                              label={`Elegir ${person.name}`}
                              checked={selected.includes(person.key)}
                              onChange={(checked) => toggleKey(person.key, checked)}
                            />
                          ) : null}
                          <span className="max-w-full min-w-0 truncate text-sm">{person.name}</span>
                          {person.instagram ? (
                            <span className="text-xs text-muted-foreground">
                              @{person.instagram}
                            </span>
                          ) : null}
                          {together ? (
                            <span className="text-xs text-muted-foreground">
                              {person.role === "TITULAR" ? "Titular" : "Acompañante"}
                            </span>
                          ) : null}
                          {person.detail ? <span className="text-sm">{person.detail}</span> : null}
                          {mode === "ALL" || target === "GROUP" || !isSendable(person) ? (
                            <PersonStatus person={person} />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          {mode === "ALL" && groups.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {allKeys.length === 0 ? "Todos ya lo tienen." : summaryLine}
            </p>
          ) : null}

          {error ? <Alert variant="destructive">{error}</Alert> : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancelar</AlertDialogCancel>
            <Button type="button" disabled={sending || count === 0} onClick={submit}>
              {sending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
              {mode === "ALL" ? `Enviar a todos (${count})` : `Enviar a seleccionados (${count})`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
