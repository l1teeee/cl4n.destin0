"use client";

import { useActionState } from "react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { adminRoles, type AdminRole } from "@/domain/admin/admin-access";

import { adminRoleLabel } from "./view-model";

type FormAction = (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;

const initialState: AdminActionState = { ok: false, message: "" };
const inputClass = "rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100";
const submitClass =
  "rounded bg-zinc-100 px-4 py-2 font-medium text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50";

function StatusMessage({ state }: { state: AdminActionState }) {
  if (!state.message) return null;
  return (
    <p className={state.ok ? "text-sm text-emerald-400" : "text-sm text-red-400"} role="status">
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
    <label className="grid gap-1">
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
      <label className="grid gap-1">
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
      <label className="grid gap-1">
        <span>Nombre</span>
        <input className={inputClass} name="displayName" maxLength={80} required />
      </label>
      <label className="grid gap-1">
        <span>Rol</span>
        <RoleSelect defaultValue="ADMIN" />
      </label>
      <PasswordInput name="password" label="Contraseña inicial" autoComplete="new-password" />
      <PasswordInput
        name="passwordConfirmation"
        label="Confirmar contraseña"
        autoComplete="new-password"
      />
      <p className="text-sm text-zinc-400">
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
      <label className="grid gap-1">
        <span>Nombre</span>
        <input
          className={inputClass}
          name="displayName"
          defaultValue={displayName}
          maxLength={80}
          required
        />
      </label>
      <label className="grid gap-1">
        <span>Rol</span>
        <RoleSelect defaultValue={role} disabled={roleLocked} />
        {roleLocked ? (
          <>
            <input type="hidden" name="role" value={role} />
            <span className="text-sm text-zinc-400">No puedes cambiar tu propio rol.</span>
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
