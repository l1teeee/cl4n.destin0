export default function Loading() {
  return (
    <main className="admin-page space-y-8" aria-busy="true">
      <div>
        <p className="admin-eyebrow">Mensajes</p>
        <h1 className="admin-title">Plantillas</h1>
        <p className="admin-description">Textos automáticos enviados por Instagram.</p>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-96 animate-pulse bg-accent motion-reduce:animate-none" />
        ))}
      </div>
    </main>
  );
}
