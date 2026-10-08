"use client";

import { useActionState } from "react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { adminRoles, type AdminRole } from "@/domain/admin/admin-access";

import { adminRoleLabel } from "./view-model";

type FormAction = (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;

const initialState: AdminActionState = { ok: false, message: "" };
const inputClass = "admin-input";
const submitClass = "admin-button";

function StatusMessage({ state }: { state: AdminActionState }) {
  if (!state.message) return null;
  return (
    <p className={state.ok ? "admin-notice-success" : "admin-notice-error"} role="status">
      {state.message}
    </p>
  );
}

function RoleSelect({ defaultValue, disabled }: { defaultValue: AdminRole; disabled?: boolean }) {
  return (
    <select className={inputClass} name="role" defaultValue={defaultValue} disabled={disabled}>
      {adminRoles.map((role) => (
        <option key={role} value={role}>
          {adminRoleLabel(role)}
        </option>
      ))}
    </select>
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
    <label className="admin-label grid gap-2">
      <span>{label}</span>
      <input
        className={inputClass}
        name={name}
        type="password"
        autoComplete={autoComplete}
        minLength={autoComplete === "new-password" ? 12 : 1}
        maxLength={autoComplete === "new-password" ? 256 : 1024}
        required
      />
    </label>
  );
}

export function AdminUserCreateForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="grid max-w-xl gap-4">
      <label className="admin-label grid gap-2">
        <span>Email</span>
        <input
          className={inputClass}
          name="email"
          type="email"
          autoComplete="off"
          maxLength={254}
          required
        />
      </label>
      <label className="admin-label grid gap-2">
        <span>Nombre</span>
        <input className={inputClass} name="displayName" maxLength={80} required />
      </label>
      <label className="admin-label grid gap-2">
        <span>Rol</span>
        <RoleSelect defaultValue="ADMIN" />
      </label>
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
        <button className={submitClass} type="submit" disabled={pending}>
          {pending ? "Creando..." : "Crear administrador"}
        </button>
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
      <label className="admin-label grid gap-2">
        <span>Nombre</span>
        <input
          className={inputClass}
          name="displayName"
          defaultValue={displayName}
          maxLength={80}
          required
        />
      </label>
      <label className="admin-label grid gap-2">
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
      </label>
      <div>
        <button className={submitClass} type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar cambios"}
        </button>
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
        <button className={submitClass} type="submit" disabled={pending}>
          {pending
            ? "Guardando..."
            : mode === "change"
              ? "Cambiar contraseña"
              : "Restablecer contraseña"}
        </button>
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
        <button className={submitClass} type="submit" disabled={requestPending}>
          {requestPending ? "Enviando..." : "Enviar código"}
        </button>
      </form>
      <StatusMessage state={requestState} />

      {requestState.ok ? (
        <form action={confirmFormAction} className="grid gap-4">
          <label className="admin-label grid gap-2">
            <span>Código de confirmación</span>
            <input
              className={inputClass}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              required
            />
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <button className="admin-button-danger" type="submit" disabled={confirmPending}>
              {confirmPending ? "Eliminando..." : "Eliminar definitivamente"}
            </button>
            <button
              className="admin-link text-sm"
              type="submit"
              formAction={requestFormAction}
              disabled={requestPending}
            >
              Solicitar un código nuevo
            </button>
          </div>
          <StatusMessage state={confirmState} />
        </form>
      ) : null}
    </div>
  );
}
