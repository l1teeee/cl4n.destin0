import type { Metadata } from "next";

import "../legal.css";
import { LegalDocument } from "@/ui/public/legal-document";

export const metadata: Metadata = {
  title: "Política de privacidad | Clandestino",
};

export default function PrivacyPage() {
  return (
    <LegalDocument title="Política de privacidad" updatedAt="1 de noviembre de 2026">
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
        Solo el panel del equipo usa una cookie de sesión para iniciar sesión.
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
