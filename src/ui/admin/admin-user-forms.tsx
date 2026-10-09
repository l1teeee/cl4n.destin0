"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { adminRoles, type AdminRole } from "@/domain/admin/admin-access";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";

import { adminRoleLabel } from "./view-model";

type FormAction = (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;

const initialState: AdminActionState = { ok: false, message: "" };
function StatusMessage({ state }: { state: AdminActionState }) {
  if (!state.message) return null;
  return (
    <Alert variant={state.ok ? "success" : "destructive"} role="status">
      {state.message}
    </Alert>
  );
}

function RoleSelect({ defaultValue, disabled }: { defaultValue: AdminRole; disabled?: boolean }) {
  return (
    <Select name="role" defaultValue={defaultValue} disabled={disabled}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {adminRoles.map((role) => (
          <SelectItem key={role} value={role}>
            {adminRoleLabel(role)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PasswordInput({
  name,
  label,
  autoComplete,
}: {
  name: string;
  label: string;
  autoComplete: "new-password" | "current-password";
}) {
  return (
    <Label className="grid gap-2">
      <span>{label}</span>
      <Input
        name={name}
        type="password"
        autoComplete={autoComplete}
        minLength={autoComplete === "new-password" ? 12 : 1}
        maxLength={autoComplete === "new-password" ? 256 : 1024}
        required
      />
    </Label>
  );
}

export function AdminUserCreateForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="grid max-w-xl gap-4">
      <Label className="grid gap-2">
        <span>Email</span>
        <Input name="email" type="email" autoComplete="off" maxLength={254} required />
      </Label>
      <Label className="grid gap-2">
        <span>Nombre</span>
        <Input name="displayName" maxLength={80} required />
      </Label>
      <Label className="grid gap-2">
        <span>Rol</span>
        <RoleSelect defaultValue="ADMIN" />
      </Label>
      <PasswordInput name="password" label="Contraseña inicial" autoComplete="new-password" />
      <PasswordInput
        name="passwordConfirmation"
        label="Confirmar contraseña"
        autoComplete="new-password"
      />
      <p className="admin-muted text-sm">
        Mínimo 12 caracteres. Comparte la contraseña por un canal seguro.
      </p>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Creando..." : "Crear administrador"}
        </Button>
      </div>
      <StatusMessage state={state} />
    </form>
  );
}

export function AdminUserProfileForm({
  action,
  displayName,
  role,
  roleLocked,
}: {
  action: FormAction;
  displayName: string;
  role: AdminRole;
  roleLocked: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="grid max-w-xl gap-4">
      <input type="hidden" name="expectedRole" value={role} />
      <Label className="grid gap-2">
        <span>Nombre</span>
        <Input name="displayName" defaultValue={displayName} maxLength={80} required />
      </Label>
      <Label className="grid gap-2">
        <span>Rol</span>
        <RoleSelect defaultValue={role} disabled={roleLocked} />
        {roleLocked ? (
          <>
            <input type="hidden" name="role" value={role} />
            <span className="admin-muted text-sm normal-case tracking-normal">
              No puedes cambiar tu propio rol.
            </span>
          </>
        ) : null}
      </Label>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
      <StatusMessage state={state} />
    </form>
  );
}

export function PasswordForm({ action, mode }: { action: FormAction; mode: "reset" | "change" }) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="grid max-w-xl gap-4">
      {mode === "change" ? (
        <>
          <PasswordInput
            name="currentPassword"
            label="Contraseña actual"
            autoComplete="current-password"
          />
          <PasswordInput name="newPassword" label="Nueva contraseña" autoComplete="new-password" />
          <PasswordInput
            name="newPasswordConfirmation"
            label="Confirmar nueva contraseña"
            autoComplete="new-password"
          />
        </>
      ) : (
        <>
          <PasswordInput name="password" label="Nueva contraseña" autoComplete="new-password" />
          <PasswordInput
            name="passwordConfirmation"
            label="Confirmar contraseña"
            autoComplete="new-password"
          />
        </>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending
            ? "Guardando..."
            : mode === "change"
              ? "Cambiar contraseña"
              : "Restablecer contraseña"}
        </Button>
      </div>
      <StatusMessage state={state} />
    </form>
  );
}

export function AdminUserDeletionForm({
  requestAction,
  confirmAction,
}: {
  requestAction: FormAction;
  confirmAction: FormAction;
}) {
  const [requestState, requestFormAction, requestPending] = useActionState(
    requestAction,
    initialState,
  );
  const [confirmState, confirmFormAction, confirmPending] = useActionState(
    confirmAction,
    initialState,
  );

  return (
    <div className="grid max-w-xl gap-4">
      <p className="admin-muted">
        Esta acción es permanente. Te enviaremos un código a tu correo para confirmarla.
      </p>
      <form action={requestFormAction}>
        <Button type="submit" disabled={requestPending}>
          {requestPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {requestPending ? "Enviando..." : "Enviar código"}
        </Button>
      </form>
      <StatusMessage state={requestState} />

      {requestState.ok ? (
        <form action={confirmFormAction} className="grid gap-4">
          <Label className="grid gap-2">
            <span>Código de confirmación</span>
            <Input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              required
            />
          </Label>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="destructive" type="submit" disabled={confirmPending}>
              {confirmPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {confirmPending ? "Eliminando..." : "Eliminar definitivamente"}
            </Button>
            <Button
              variant="link"
              size="sm"
              className="text-sm"
              type="submit"
              formAction={requestFormAction}
              disabled={requestPending}
            >
              {requestPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Solicitar un código nuevo
            </Button>
          </div>
          <StatusMessage state={confirmState} />
        </form>
      ) : null}
    </div>
  );
}
