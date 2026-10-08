import Image from "next/image";
import Link from "next/link";

import { requestPasswordResetAction } from "./actions";

interface ForgotPageProps {
  searchParams: Promise<{ enviado?: string | string[]; error?: string | string[] }>;
}

export default async function AdminForgotPage({ searchParams }: ForgotPageProps) {
  const { enviado, error } = await searchParams;
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
          <h1 className="admin-eyebrow">Recuperar acceso</h1>
        </div>
        {enviado ? (
          <p className="admin-notice-success" role="status">
            Si el correo pertenece a un administrador, te enviamos un enlace para crear una nueva
            contraseña.
          </p>
        ) : null}
        {error ? (
          <p className="admin-notice-error" role="alert">
            Ingresa un email válido.
          </p>
        ) : null}
        <form action={requestPasswordResetAction} className="grid gap-4">
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
          <button className="admin-button admin-button-full mt-2" type="submit">
            Enviar enlace
          </button>
        </form>
        <Link className="admin-link" href="/admin/login">
          Volver a ingresar
        </Link>
      </div>
    </main>
  );
}
