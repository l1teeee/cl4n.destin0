import type { ReactNode } from "react";

import { Badge, type BadgeVariant } from "@/ui/primitives/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/primitives/table";

import { GuestAllergies } from "./guest-allergies";
import { GuestIdentityList, type GuestIdentity } from "./guest-identity-list";

const columnHeadings = [
  "Número",
  "Invitados",
  "Personas",
  "Alergias",
  "Estado",
  "Mensaje",
  "Recibida",
  "Acciones",
];

interface BadgeView {
  label: string;
  variant: BadgeVariant;
}

interface MessageBadgeView extends BadgeView {
  title?: string;
}

export interface GuestRowView {
  key: string;
  numberLabel: string;
  guests: readonly GuestIdentity[];
  partyLabel: string;
  allergies: string | null;
  notes: string | null;
  status: BadgeView;
  extra: BadgeView | null;
  message: MessageBadgeView | null;
  submittedLabel: string;
  detail: ReactNode | null;
  actions: ReactNode | null;
}

interface GuestTableProps {
  rows: readonly GuestRowView[];
  emptyText: string;
}

export function GuestTable({ rows, emptyText }: GuestTableProps) {
  if (rows.length === 0) return <p className="admin-empty">{emptyText}</p>;

  return (
    <Table className="min-w-[1100px]">
      <TableHeader>
        <TableRow>
          {columnHeadings.map((heading) => (
            <TableHead key={heading}>{heading}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <GuestTableRow key={row.key} row={row} index={index} />
        ))}
      </TableBody>
    </Table>
  );
}

// TableCell centers vertically by default, which pulls a row apart once the guests cell has
// several lines, so every cell of the row is aligned to the top.
function GuestTableRow({ row, index }: { row: GuestRowView; index: number }) {
  return (
    <TableRow
      className="animate-in fill-mode-both fade-in-0 slide-in-from-bottom-1 align-top duration-300 [&>td]:align-top"
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <TableCell className="font-mono">{row.numberLabel}</TableCell>
      <TableCell className="max-w-xs whitespace-normal">
        <GuestIdentityList guests={row.guests} />
        {row.notes ? (
          <p className="admin-muted mt-2 text-sm break-words whitespace-pre-line">{row.notes}</p>
        ) : null}
      </TableCell>
      <TableCell>{row.partyLabel}</TableCell>
      <TableCell className="max-w-xs whitespace-normal">
        <GuestAllergies allergies={row.allergies} />
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <Badge variant={row.status.variant}>{row.status.label}</Badge>
          {row.extra ? <Badge variant={row.extra.variant}>{row.extra.label}</Badge> : null}
        </div>
      </TableCell>
      <TableCell>
        {row.message ? (
          <Badge variant={row.message.variant} title={row.message.title}>
            {row.message.label}
          </Badge>
        ) : (
          <span className="admin-muted">-</span>
        )}
      </TableCell>
      <TableCell>{row.submittedLabel}</TableCell>
      <TableCell>
        <div className="flex flex-wrap items-start gap-2">
          {row.detail}
          {row.actions}
        </div>
      </TableCell>
    </TableRow>
  );
}
