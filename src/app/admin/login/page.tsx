import Image from "next/image";
import Link from "next/link";

import { signInAction } from "./actions";

interface LoginPageProps {
  searchParams: Promise<{ error?: string | string[]; restablecida?: string | string[] }>;
}

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const { error, restablecida } = await searchParams;
  return (
    <main className="admin-login">
      <div className="admin-login-panel">
        <div className="admin-login-brand">
          <Image
            className="admin-wordmark"
            src="/clandestino-wordmark.png"
            alt="Clandestino"
            width={800}
            height={800}
            priority
          />
          <h1 className="admin-eyebrow">Administración</h1>
        </div>
        {restablecida ? (
          <p className="admin-notice-success" role="status">
            Tu contraseña se actualizó. Ya puedes iniciar sesión.
          </p>
        ) : null}
        {error ? (
          <p className="admin-notice-error" role="alert">
            No se pudo iniciar sesión. Verifica tus credenciales.
          </p>
        ) : null}
        <form action={signInAction} className="grid gap-4">
          <label className="admin-label grid gap-2">
            <span>Email</span>
            <input
              className="admin-input"
              name="email"
              type="email"
              autoComplete="username"
              required
            />
          </label>
          <label className="admin-label grid gap-2">
            <span>Contraseña</span>
            <input
              className="admin-input"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="admin-button admin-button-full mt-2" type="submit">
            Ingresar
          </button>
        </form>
        <Link className="admin-link" href="/admin/forgot">
          ¿Olvidaste tu contraseña?
        </Link>
      </div>
    </main>
  );
}
