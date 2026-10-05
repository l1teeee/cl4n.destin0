import { signInAction } from "./actions";

interface LoginPageProps {
  searchParams: Promise<{ error?: string | string[] }>;
}

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const error = (await searchParams).error;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4">
      <h1 className="text-3xl font-semibold">Administración</h1>
      {error ? (
        <p className="rounded border border-red-800 bg-red-950 p-3 text-red-200" role="alert">
          No se pudo iniciar sesión. Verifica tus credenciales.
        </p>
      ) : null}
      <form action={signInAction} className="grid gap-4">
        <label className="grid gap-1">
          <span>Email</span>
          <input
            className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
            name="email"
            type="email"
            autoComplete="username"
            required
          />
        </label>
        <label className="grid gap-1">
          <span>Contraseña</span>
          <input
            className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button className="rounded bg-zinc-100 px-4 py-2 font-medium text-zinc-950" type="submit">
          Ingresar
        </button>
      </form>
    </main>
  );
}
