import Image from "next/image";
import Link from "next/link";

import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";

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
          <Alert variant="success" role="status">
            Tu contraseña se actualizó. Ya puedes iniciar sesión.
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive" role="alert">
            No se pudo iniciar sesión. Verifica tus credenciales.
          </Alert>
        ) : null}
        <form action={signInAction} className="grid gap-4">
          <Label className="grid gap-2">
            <span>Email</span>
            <Input name="email" type="email" autoComplete="username" required />
          </Label>
          <Label className="grid gap-2">
            <span>Contraseña</span>
            <Input name="password" type="password" autoComplete="current-password" required />
          </Label>
          <Button className="mt-2 w-full" type="submit">
            Ingresar
          </Button>
        </form>
        <Button variant="link" asChild>
          <Link href="/admin/forgot">¿Olvidaste tu contraseña?</Link>
        </Button>
      </div>
    </main>
  );
}
