"use client";

import { useActionState } from "react";

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
  AlertDialogTrigger,
} from "@/ui/primitives/alert-dialog";
import { Badge } from "@/ui/primitives/badge";
import { Button, buttonVariants } from "@/ui/primitives/button";
import type { InstagramConnectionNotice } from "./instagram-connection-notices";

export interface InstagramConnectionPanelProps {
  mode: "log" | "instagram";
  connection: {
    username: string;
    connectedAtLabel: string;
    tokenExpiresAtLabel: string;
    expiresSoon: boolean;
  } | null;
  requiredUsername: string | null;
  notice: InstagramConnectionNotice | null;
  disconnectAction: (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;
}

const initialState: AdminActionState = { ok: false, message: "" };

function noticeAlert(
  notice: InstagramConnectionNotice,
  requiredUsername: string | null,
): { variant: "default" | "destructive" | "success"; message: string } {
  switch (notice) {
    case "connected":
      return { variant: "success", message: "Instagram quedó vinculado." };
    case "cancelled":
      return { variant: "default", message: "Cancelaste la vinculación." };
    case "failed":
      return {
        variant: "destructive",
        message: "No se pudo vincular Instagram. Intenta de nuevo.",
      };
    case "invalid_state":
      return {
        variant: "destructive",
        message: "La vinculación expiró o no es válida. Intenta de nuevo.",
      };
    case "wrong_account":
      return {
        variant: "destructive",
        message: requiredUsername
          ? `Esa no es la cuenta @${requiredUsername}. Entra con esa cuenta e intenta de nuevo.`
          : "Esa no es la cuenta del Clan. Intenta de nuevo con la cuenta correcta.",
      };
    case "missing_permission":
      return {
        variant: "destructive",
        message: "Falta el permiso de mensajes. Acepta todos los permisos al vincular.",
      };
    case "subscribe_failed":
      return {
        variant: "destructive",
        message:
          "La cuenta se conectó, pero no se activaron los mensajes entrantes. Intenta de nuevo.",
      };
    case "forbidden":
      return {
        variant: "destructive",
        message: "Solo un superadministrador puede vincular Instagram.",
      };
  }
}

export function InstagramConnectionPanel({
  mode,
  connection,
  requiredUsername,
  notice,
  disconnectAction,
}: InstagramConnectionPanelProps) {
  const [state, formAction, pending] = useActionState(disconnectAction, initialState);
  const topNotice = notice ? noticeAlert(notice, requiredUsername) : null;

  return (
    <section className="admin-section space-y-4">
      <h2 className="admin-section-title">Cuenta de Instagram</h2>
      {topNotice ? <Alert variant={topNotice.variant}>{topNotice.message}</Alert> : null}
      {mode === "log" ? (
        <p className="admin-muted">Modo de prueba: los mensajes no salen a Instagram.</p>
      ) : connection === null ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <Badge variant="waitlist">Sin vincular</Badge>
            <p className="admin-muted">
              {requiredUsername
                ? `Vincula la cuenta @${requiredUsername} para enviar y recibir mensajes.`
                : "Vincula la cuenta de Instagram del Clan para enviar y recibir mensajes."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a href="/api/instagram/connect" className={buttonVariants()}>
              Vincular Instagram
            </a>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="confirmed">Vinculada</Badge>
              <span>@{connection.username}</span>
            </div>
            <p className="admin-muted">Vinculada el {connection.connectedAtLabel}</p>
            <p className="admin-muted">
              El permiso se renueva solo. Vence el {connection.tokenExpiresAtLabel}.
            </p>
            {connection.expiresSoon ? (
              <Alert variant="destructive">
                El permiso vence pronto. Vuelve a vincular la cuenta.
              </Alert>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a href="/api/instagram/connect" className={buttonVariants({ variant: "outline" })}>
              Volver a vincular
            </a>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={pending}>
                  Desvincular
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Desvincular Instagram</AlertDialogTitle>
                  <AlertDialogDescription>
                    Los mensajes a invitados quedarán en espera hasta que vuelvas a vincular la
                    cuenta.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <form action={formAction}>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <Button type="submit" variant="destructive" disabled={pending}>
                      {pending ? "Desvinculando..." : "Desvincular"}
                    </Button>
                  </AlertDialogFooter>
                </form>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}
      {state.message ? (
        <Alert variant={state.ok ? "success" : "destructive"} role="status">
          {state.message}
        </Alert>
      ) : null}
    </section>
  );
}
