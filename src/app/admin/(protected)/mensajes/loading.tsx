export default function Loading() {
  return (
    <main className="flex h-[calc(100svh_-_3.5rem)] min-h-0 md:h-svh" aria-busy="true">
      <div className="w-full border-r border-border p-4 md:w-80">
        <div className="h-16 animate-pulse bg-accent motion-reduce:animate-none" />
        <div className="mt-4 h-28 animate-pulse bg-accent motion-reduce:animate-none" />
        <div className="mt-4 h-20 animate-pulse bg-accent motion-reduce:animate-none" />
      </div>
      <div className="hidden flex-1 p-6 md:block">
        <div className="h-full animate-pulse bg-accent motion-reduce:animate-none" />
      </div>
    </main>
  );
}
