import type { Metadata } from "next";
import Link from "next/link";

import { getPublicLocale } from "@/ui/public/i18n/locale";
import { legalMessages } from "@/ui/public/i18n/pages";
import { configuredInstagramUsername, instagramProfileUrl } from "@/ui/public/instagram-profile";
import { LegalDocument } from "@/ui/public/legal-document";

import "../legal.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getPublicLocale();
  return {
    title: legalMessages[locale].termsMetaTitle,
  };
}

export default async function TermsPage() {
  const locale = await getPublicLocale();
  const instagramUsername = configuredInstagramUsername();

  if (locale === "en") {
    return (
      <LegalDocument title="Terms" updatedAt="November 1, 2026" locale={locale}>
        <p>This English version is provided for convenience. The Spanish version prevails.</p>

        <p>
          These terms apply to requests and experiences of Clandestino Supper Clan in El Salvador.
          By submitting a request you accept these terms and the{" "}
          <Link href="/privacidad">Privacy Policy</Link>.
        </p>

        <h2>Who organizes</h2>
        <p>
          Clandestino Supper Clan, El Salvador. Contact: direct message on{" "}
          {instagramUsername ? (
            <>
              Instagram to{" "}
              <a
                href={instagramProfileUrl(instagramUsername)}
                target="_blank"
                rel="noopener noreferrer"
              >
                @{instagramUsername}
              </a>
              .
            </>
          ) : (
            "Instagram."
          )}
        </p>

        <h2>How a request works</h2>
        <p>
          By default each request is for one person or a pair, and some experiences may allow more
          people. The request asks for the name and Instagram handle of each person. Seats are
          allocated in the order requests arrive; once full, the request automatically joins the
          waitlist. Submitting a request does not guarantee a seat: the team reviews each request
          and may accept or reject it. The same Instagram account cannot have more than one request
          per experience.
        </p>

        <h2>List, payment, and confirmation</h2>
        <p>
          If your request is accepted you are placed on the list and we message you on Instagram
          with the price and payment details. Your seat is confirmed only once we verify payment. If
          you do not pay within the deadline stated in the message, the team may release your seat
          to someone else. If a seat becomes available, the first person on the waitlist gets it.
        </p>

        <h2>Cancellations and refunds</h2>
        <p>
          Payments are non-refundable. If you cannot attend, you may transfer your seat to another
          person by notifying us via direct message before the experience; that person must comply
          with these terms. If Clandestino cancels the experience, we issue a full refund.
        </p>

        <h2>Minimum age</h2>
        <p>
          Only persons 18 years of age or older may request and attend. We may ask for
          identification upon arrival.
        </p>

        <h2>Location</h2>
        <p>
          The location is sent by direct message only to confirmed guests. Please do not share it
          publicly.
        </p>

        <h2>Allergies</h2>
        <p>
          If you indicate allergies, we will do our best to adapt the experience, but we cannot
          guarantee the complete absence of traces. It is your responsibility to inform us before
          the experience.
        </p>

        <h2>Use of the site</h2>
        <p>
          Automated or fake requests are prohibited. The site uses Cloudflare verification to detect
          bots. We may reject requests that violate these terms.
        </p>

        <h2>Changes to the experience</h2>
        <p>
          The date, time, or menu may change due to circumstances beyond our control; we will notify
          you by direct message.
        </p>

        <h2>Applicable law</h2>
        <p>These terms are governed by the laws of El Salvador.</p>

        <h2>Changes to these terms</h2>
        <p>If they change, we update this page and the date above.</p>
      </LegalDocument>
    );
  }

  return (
    <LegalDocument title="Términos" updatedAt="1 de noviembre de 2026" locale={locale}>
      <p>
        Estos términos aplican a las solicitudes y experiencias de Clandestino Supper Clan, en El
        Salvador. Al enviar una solicitud aceptas estos términos y la{" "}
        <Link href="/privacidad">Política de privacidad</Link>.
      </p>

      <h2>Quién organiza</h2>
      <p>
        Clandestino Supper Clan, El Salvador. Contacto: mensaje directo por{" "}
        {instagramUsername ? (
          <>
            Instagram a{" "}
            <a
              href={instagramProfileUrl(instagramUsername)}
              target="_blank"
              rel="noopener noreferrer"
            >
              @{instagramUsername}
            </a>
            .
          </>
        ) : (
          "Instagram."
        )}
      </p>

      <h2>Cómo funciona una solicitud</h2>
      <p>
        Por defecto cada solicitud es para una persona o una pareja, y algunas experiencias pueden
        admitir más personas. La solicitud pide el nombre y el usuario de Instagram de cada persona.
        Los lugares se asignan en el orden en que llegan las solicitudes; cuando se llenan, la
        solicitud entra automáticamente a la cola. Enviar una solicitud no garantiza un lugar: el
        equipo revisa cada solicitud y puede aceptarla o rechazarla. Una misma cuenta de Instagram
        no puede tener más de una solicitud por experiencia.
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
