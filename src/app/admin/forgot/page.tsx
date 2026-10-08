import Image from "next/image";
import Link from "next/link";

import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";

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
          <Alert variant="success" role="status">
            Si el correo pertenece a un administrador, te enviamos un enlace para crear una nueva
            contraseña.
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive" role="alert">
            Ingresa un email válido.
          </Alert>
        ) : null}
        <form action={requestPasswordResetAction} className="grid gap-4">
          <Label className="grid gap-2">
            <span>Email</span>
            <Input name="email" type="email" autoComplete="username" required />
          </Label>
          <Button className="mt-2 w-full" type="submit">
            Enviar enlace
          </Button>
        </form>
        <Button variant="link" asChild>
          <Link href="/admin/login">Volver a ingresar</Link>
        </Button>
      </div>
    </main>
  );
}
