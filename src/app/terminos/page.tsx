import type { Metadata } from "next";
import Link from "next/link";

import "../legal.css";
import { LegalDocument } from "@/ui/public/legal-document";

export const metadata: Metadata = {
  title: "Términos | Clandestino",
};

export default function TermsPage() {
  return (
    <LegalDocument title="Términos" updatedAt="1 de noviembre de 2026">
      <p>
        Estos términos aplican a las solicitudes y experiencias de Clandestino Supper Clan, en El
        Salvador. Al enviar una solicitud aceptas estos términos y la{" "}
        <Link href="/privacidad">Política de privacidad</Link>.
      </p>

      <h2>Quién organiza</h2>
      <p>
        Clandestino Supper Clan, El Salvador. Contacto: mensaje directo a{" "}
        <a href="https://instagram.com/cl4n.destin0" target="_blank" rel="noopener noreferrer">
          @cl4n.destin0
        </a>{" "}
        en Instagram.
      </p>

      <h2>Cómo funciona una solicitud</h2>
      <p>
        Cada solicitud es para una persona o una pareja (máximo 2) y pide el nombre y el usuario de
        Instagram de cada persona. Los lugares se asignan en el orden en que llegan las solicitudes;
        cuando se llenan, la solicitud entra automáticamente a la cola. Enviar una solicitud no
        garantiza un lugar: el equipo revisa cada solicitud y puede aceptarla o rechazarla. Una
        misma cuenta de Instagram no puede tener más de una solicitud por experiencia.
      </p>

      <h2>Lista, pago y confirmación</h2>
      <p>
        Si tu solicitud es aceptada pasas a la lista y te escribimos por Instagram con el precio y
        la forma de pago. Tu lugar queda confirmado solo cuando verificamos el pago. Si no pagas en
        el plazo indicado en el mensaje, el equipo puede liberar tu lugar para otra persona. Si se
        libera un lugar, entra la primera persona de la cola.
      </p>

      <h2>Cancelaciones y reembolsos</h2>
      <p>
        Los pagos no son reembolsables. Si no puedes asistir, puedes ceder tu lugar a otra persona
        avisándonos por mensaje directo antes de la experiencia; esa persona debe cumplir estos
        términos. Si Clandestino cancela la experiencia, te devolvemos el pago completo.
      </p>

      <h2>Edad mínima</h2>
      <p>
        Solo pueden solicitar y asistir personas de 18 años o más. Podemos pedir una identificación
        al llegar.
      </p>

      <h2>Ubicación</h2>
      <p>
        La ubicación se envía por mensaje directo solo a personas confirmadas. Te pedimos no
        compartirla públicamente.
      </p>

      <h2>Alergias</h2>
      <p>
        Si indicas alergias, haremos lo posible por adaptar la experiencia, pero no podemos
        garantizar la ausencia total de trazas. Es tu responsabilidad informarnos antes de la
        experiencia.
      </p>

      <h2>Uso del sitio</h2>
      <p>
        Está prohibido enviar solicitudes automatizadas o falsas. El sitio usa una verificación de
        Cloudflare para detectar bots. Podemos rechazar solicitudes que incumplan estos términos.
      </p>

      <h2>Cambios en la experiencia</h2>
      <p>
        La fecha, la hora o el menú pueden cambiar por causas de fuerza mayor; te avisaremos por
        mensaje directo.
      </p>

      <h2>Ley aplicable</h2>
      <p>Estos términos se rigen por las leyes de El Salvador.</p>

      <h2>Cambios a estos términos</h2>
      <p>Si cambian, actualizamos esta página y la fecha de arriba.</p>
    </LegalDocument>
  );
}
