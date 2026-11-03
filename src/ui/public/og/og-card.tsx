export function OgCard({ dateLine, footer }: { dateLine: string | null; footer: string }) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "#11120d",
        color: "#fffbf4",
        padding: 72,
        flexDirection: "column",
        justifyContent: "space-between",
        fontFamily: "Funnel Sans",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div
          style={{
            display: "flex",
            width: 56,
            height: 56,
            border: "12px solid #fffbf4",
            borderRadius: "50%",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "#fffbf4",
            }}
          />
        </div>
        <div style={{ display: "flex", fontSize: 28, fontWeight: 600, letterSpacing: "0.35em" }}>
          CLANDESTINO
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 96, fontWeight: 600, lineHeight: 1.05 }}>
          El clan está abierto
        </div>
        {dateLine !== null && (
          <div
            style={{
              display: "flex",
              fontSize: 40,
              fontWeight: 400,
              color: "rgba(255, 251, 244, 0.72)",
            }}
          >
            {dateLine}
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 26,
          letterSpacing: "0.3em",
          color: "rgba(255, 251, 244, 0.6)",
          textTransform: "uppercase",
        }}
      >
        {footer}
      </div>
    </div>
  );
}
