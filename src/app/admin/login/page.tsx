import { signInAction } from "./actions";

interface LoginPageProps {
  searchParams: Promise<{ error?: string | string[] }>;
}

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const error = (await searchParams).error;

  return (
    <main>
      <h1>Administración</h1>
      {error ? <p role="alert">No se pudo iniciar sesión. Verifica tus credenciales.</p> : null}
      <form action={signInAction}>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Contraseña
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Ingresar</button>
      </form>
    </main>
  );
}
