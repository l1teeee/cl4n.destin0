import Link from "next/link";

// Blank means not configured. A leading @ is dropped so the profile link stays valid.
function configuredInstagramUsername(): string | undefined {
  const username = process.env.NEXT_PUBLIC_INSTAGRAM_USERNAME?.trim().replace(/^@/, "");
  return username ? username : undefined;
}

export function PublicFooter() {
  const instagramUsername = configuredInstagramUsername();

  return (
    <footer className="public-footer">
      <p className="public-footer-name">Clandestino</p>
      <nav className="public-footer-links" aria-label="Pie de página">
        {instagramUsername ? (
          <a
            href={`https://instagram.com/${encodeURIComponent(instagramUsername)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Instagram
          </a>
        ) : null}
        <Link href="/privacidad">Privacidad</Link>
        <Link href="/terminos">Términos</Link>
      </nav>
    </footer>
  );
}
