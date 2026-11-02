import type { Metadata } from "next";

import { getPublicLocale } from "@/ui/public/i18n/locale";
import { legalMessages } from "@/ui/public/i18n/pages";
import { LegalDocument } from "@/ui/public/legal-document";

import "../legal.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getPublicLocale();
  return {
    title: legalMessages[locale].privacyMetaTitle,
  };
}

export default async function PrivacyPage() {
  const locale = await getPublicLocale();

  if (locale === "en") {
    return (
      <LegalDocument title="Privacy Policy" updatedAt="November 1, 2026" locale={locale}>
        <p>This English version is provided for convenience. The Spanish version prevails.</p>

        <p>
          This policy explains what data we store when you request a seat at Clandestino Supper
          Clan, what we use it for, and how we protect it.
        </p>

        <h2>Responsible party</h2>
        <p>
          Clandestino Supper Clan, El Salvador. Contact: direct message to{" "}
          <a href="https://instagram.com/cl4n.destin0" target="_blank" rel="noopener noreferrer">
            @cl4n.destin0
          </a>{" "}
          on Instagram.
        </p>

        <h2>What data we store</h2>
        <ul>
          <li>The name and Instagram handle of each person in the request (maximum 2).</li>
          <li>Whether you have allergies and which ones.</li>
          <li>Any notes you write, if you provide any.</li>
          <li>
            The direct messages we exchange on Instagram and any images you send us, such as proof
            of payment.
          </li>
          <li>
            The status of your request (under review, on the list, confirmed, on the waitlist,
            cancelled).
          </li>
        </ul>

        <h2>Technical data</h2>
        <p>
          To prevent abuse and duplicate requests, we use your IP address in a protected way (we
          store only a code derived from it, not the IP itself) and for a short time. Cloudflare
          Turnstile processes data such as your IP and browser information to verify that you are a
          human; see the{" "}
          <a
            href="https://www.cloudflare.com/turnstile-privacy-policy/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Turnstile privacy policy
          </a>
          .
        </p>

        <h2>What we use it for</h2>
        <ul>
          <li>Review your request.</li>
          <li>Organize the list, waitlist, and payments.</li>
          <li>Send you confirmation, clues, and location via Instagram.</li>
          <li>Prepare the experience according to your allergies.</li>
        </ul>
        <p>We do not use your data for advertising and we do not sell it.</p>

        <h2>Health data (allergies)</h2>
        <p>
          Allergy information is sensitive data. We only use it to prepare your experience, only the
          organizing team sees it, and you give us your explicit consent by accepting this policy in
          the form.
        </p>

        <h2>Who can see it</h2>
        <p>
          Only the organizing team, using password-protected personal accounts. To operate, we use
          these service providers, who process data on our behalf:
        </p>
        <ul>
          <li>Vercel (website hosting).</li>
          <li>Railway (database).</li>
          <li>Cloudflare (bot protection).</li>
          <li>Meta / Instagram (direct messages).</li>
        </ul>
        <p>
          Some of these providers store data outside El Salvador, for example in the United States.
        </p>

        <h2>How we protect it</h2>
        <p>
          All connections use encryption (HTTPS); the database connection is encrypted; access to
          the dashboard requires an account and password; only the organizing team has access.
        </p>

        <h2>How long we keep it</h2>
        <p>
          90 days after the date of the experience, we automatically delete names, Instagram
          handles, allergies, notes, messages, and images from that experience. We only keep
          anonymized data, such as how many seats were filled.
        </p>

        <h2>Your rights</h2>
        <p>
          You can ask us to view, correct, or delete your data, object to its use, or withdraw your
          consent by sending us a direct message to{" "}
          <a href="https://instagram.com/cl4n.destin0" target="_blank" rel="noopener noreferrer">
            @cl4n.destin0
          </a>
          . If you delete your data before the experience, your request is cancelled.
        </p>

        <h2>Cookies</h2>
        <p>
          This site does not use advertising or analytics cookies. The form temporarily stores a
          code in your browser to prevent duplicate requests; it is deleted when you close the tab.
          Only the team dashboard uses a session cookie to log in. If you choose a language, we
          store that preference in a cookie (cl4n_lang) for one year.
        </p>

        <h2>Minors</h2>
        <p>
          Experiences are strictly for persons 18 and older, and we do not knowingly collect data
          from minors.
        </p>

        <h2>Security incidents</h2>
        <p>
          If an incident occurs that affects your data, we will inform you and notify the
          authorities as required by law.
        </p>

        <h2>Changes to this policy</h2>
        <p>If it changes, we update this page and the date above.</p>
      </LegalDocument>
    );
  }

  return (
    <LegalDocument
      title="Política de privacidad"
      updatedAt="1 de noviembre de 2026"
      locale={locale}
    >
      <p>
        Esta política explica qué datos guardamos cuando solicitas un lugar en Clandestino Supper
        Clan, para qué los usamos y cómo los protegemos.
      </p>

      <h2>Responsable</h2>
      <p>
        Clandestino Supper Clan, El Salvador. Contacto: mensaje directo a{" "}
        <a href="https://instagram.com/cl4n.destin0" target="_blank" rel="noopener noreferrer">
          @cl4n.destin0
        </a>{" "}
        en Instagram.
      </p>

      <h2>Qué datos guardamos</h2>
      <ul>
        <li>El nombre y el usuario de Instagram de cada persona de la solicitud (máximo 2).</li>
        <li>Si tienes alergias y cuáles.</li>
        <li>Las observaciones que escribas, si las escribes.</li>
        <li>
          Los mensajes directos que intercambiemos por Instagram y las imágenes que nos envíes, por
          ejemplo un comprobante de pago.
        </li>
        <li>
          El estado de tu solicitud (en revisión, en la lista, confirmada, en la cola, cancelada).
        </li>
      </ul>

      <h2>Datos técnicos</h2>
      <p>
        Para evitar abusos y solicitudes duplicadas usamos tu dirección IP de forma protegida
        (guardamos solo un código derivado de ella, no la IP) y por poco tiempo. Cloudflare
        Turnstile procesa datos como tu IP y la información del navegador para comprobar que eres
        una persona; consulta la{" "}
        <a
          href="https://www.cloudflare.com/turnstile-privacy-policy/"
          target="_blank"
          rel="noopener noreferrer"
        >
          política de privacidad de Turnstile
        </a>
        .
      </p>

      <h2>Para qué los usamos</h2>
      <ul>
        <li>Revisar tu solicitud.</li>
        <li>Organizar la lista, la cola y los pagos.</li>
        <li>Enviarte por Instagram la confirmación, las pistas y la ubicación.</li>
        <li>Preparar la experiencia según tus alergias.</li>
      </ul>
      <p>No usamos tus datos para publicidad y no los vendemos.</p>

      <h2>Datos de salud (alergias)</h2>
      <p>
        La información de alergias es un dato sensible. Solo la usamos para preparar tu experiencia,
        solo la ve el equipo organizador y nos das tu consentimiento expreso al aceptar esta
        política en el formulario.
      </p>

      <h2>Quién puede verlos</h2>
      <p>
        Solo el equipo organizador, con cuentas personales protegidas por contraseña. Para funcionar
        usamos estos proveedores, que procesan datos por nosotros:
      </p>
      <ul>
        <li>Vercel (alojamiento del sitio).</li>
        <li>Railway (base de datos).</li>
        <li>Cloudflare (protección contra bots).</li>
        <li>Meta / Instagram (mensajes directos).</li>
      </ul>
      <p>
        Algunos de estos proveedores almacenan datos fuera de El Salvador, por ejemplo en Estados
        Unidos.
      </p>

      <h2>Cómo los protegemos</h2>
      <p>
        Todas las conexiones usan cifrado (HTTPS); la conexión con la base de datos está cifrada; el
        acceso al panel requiere cuenta y contraseña; solo el equipo organizador tiene acceso.
      </p>

      <h2>Cuánto tiempo los guardamos</h2>
      <p>
        90 días después de la fecha de la experiencia borramos automáticamente los nombres, usuarios
        de Instagram, alergias, observaciones, mensajes e imágenes de esa experiencia. Solo
        conservamos datos sin información personal, como cuántos lugares se ocuparon.
      </p>

      <h2>Tus derechos</h2>
      <p>
        Puedes pedirnos ver, corregir o borrar tus datos, oponerte a su uso o retirar tu
        consentimiento, escribiéndonos por mensaje directo a{" "}
        <a href="https://instagram.com/cl4n.destin0" target="_blank" rel="noopener noreferrer">
          @cl4n.destin0
        </a>
        . Si borras tus datos antes de la experiencia, se cancela tu solicitud.
      </p>

      <h2>Cookies</h2>
      <p>
        Este sitio no usa cookies de publicidad ni de analítica. El formulario guarda temporalmente
        en tu navegador un código para evitar solicitudes duplicadas; se borra al cerrar la pestaña.
        Solo el panel del equipo usa una cookie de sesión para iniciar sesión. Si eliges un idioma,
        guardamos esa preferencia en una cookie (cl4n_lang) durante un año.
      </p>

      <h2>Menores de edad</h2>
      <p>
        Las experiencias son solo para mayores de 18 años y no recopilamos a sabiendas datos de
        menores.
      </p>

      <h2>Incidentes de seguridad</h2>
      <p>
        Si ocurre un incidente que afecte tus datos, te avisaremos y lo notificaremos a las
        autoridades como exige la ley.
      </p>

      <h2>Cambios a esta política</h2>
      <p>Si cambia, actualizamos esta página y la fecha de arriba.</p>
    </LegalDocument>
  );
}
