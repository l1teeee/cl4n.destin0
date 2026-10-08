import Image from "next/image";
import Link from "next/link";

import { PasswordResetForm } from "@/ui/admin/password-reset-form";

export default function AdminResetPage() {
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
          <h1 className="admin-eyebrow">Nueva contraseña</h1>
        </div>
        <PasswordResetForm />
        <Link className="admin-link" href="/admin/login">
          Volver a ingresar
        </Link>
      </div>
    </main>
  );
}
