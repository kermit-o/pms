/**
 * Plantillas de email V1 (Sprint 9 W1).
 *
 * Sin libs externas — interpolación `{{ key }}` con regex.
 * Cada plantilla devuelve `{ subject, html, text }` en el locale
 * pedido (ES/EN). Cuando el catálogo crezca migramos a MJML o
 * Handlebars.
 *
 * Reglas:
 *  - HTML mínimo viable: inline styles, sin assets externos, soportable
 *    por todos los clientes (Gmail / Outlook).
 *  - Texto fallback obligatorio (clientes en texto plano).
 *  - Branding por hotel via `params.brand.{ name, primaryColor, accentColor }`.
 *    Si no llega, defaults Aubergine.
 */

export type TemplateName =
  | 'reservation_confirmation'
  | 'reservation_cancelled'
  | 'front_desk_new_reservation';
export type Locale = 'es' | 'en';

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

export function renderTemplate(
  name: TemplateName,
  locale: Locale,
  params: Record<string, unknown>,
): RenderedTemplate {
  const dict = TEMPLATES[name];
  const def = dict[locale] ?? dict.es;
  return {
    subject: interpolate(def.subject, params),
    html: wrapHtml(interpolate(def.html, params), params),
    text: interpolate(def.text, params),
  };
}

function interpolate(src: string, params: Record<string, unknown>): string {
  return src.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = resolve(params, key.split('.'));
    return value === undefined || value === null ? '' : String(value);
  });
}

function resolve(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const segment of path) {
    if (cur && typeof cur === 'object' && segment in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return cur;
}

function wrapHtml(body: string, params: Record<string, unknown>): string {
  const brand = (params.brand ?? {}) as { name?: string; primaryColor?: string };
  const primary = brand.primaryColor ?? '#5c2a4d';
  const name = brand.name ?? 'Aubergine';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#faf6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#2a132a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;">
        <tr><td style="padding-bottom:16px;border-bottom:1px solid #e9d5e0;">
          <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#7c3f66;">${escapeHtml(name)}</p>
        </td></tr>
        <tr><td style="padding-top:24px;">${body}</td></tr>
        <tr><td style="padding-top:24px;border-top:1px solid #e9d5e0;font-size:11px;color:#9c5a85;">
          ${name} · Aubergine PMS
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`.replace('color:#5c2a4d', `color:${primary}`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

interface TplDict {
  es: { subject: string; html: string; text: string };
  en?: { subject: string; html: string; text: string };
}

const TEMPLATES: Record<TemplateName, TplDict> = {
  reservation_confirmation: {
    es: {
      subject: '✓ Reserva confirmada {{ code }} — {{ hotelName }}',
      html: `<h2 style="margin:0 0 8px 0;color:#451f3a;">Tu reserva está confirmada</h2>
<p style="color:#5c2a4d;">Hola {{ guestFirstName }}, gracias por reservar en <strong>{{ hotelName }}</strong>.</p>
<p style="background:#f6eef3;padding:12px 16px;border-radius:8px;color:#2a132a;">
  <strong style="display:block;font-size:18px;letter-spacing:0.05em;">{{ code }}</strong>
  {{ arrival }} → {{ departure }} · {{ roomTypeName }}<br>
  Total: <strong>{{ totalAmount }} {{ currency }}</strong>
</p>
<p style="color:#5c2a4d;">Si necesitas modificar o cancelar, usa tu código y apellido en <a href="{{ manageUrl }}" style="color:#5c2a4d;">esta página</a>.</p>`,
      text: `Reserva confirmada — {{ code }}\n\nHola {{ guestFirstName }},\n\nGracias por reservar en {{ hotelName }}.\n\nCódigo: {{ code }}\nLlegada: {{ arrival }}\nSalida: {{ departure }}\nTipo: {{ roomTypeName }}\nTotal: {{ totalAmount }} {{ currency }}\n\nGestiona tu reserva: {{ manageUrl }}`,
    },
    en: {
      subject: '✓ Booking confirmed {{ code }} — {{ hotelName }}',
      html: `<h2 style="margin:0 0 8px 0;color:#451f3a;">Your booking is confirmed</h2>
<p style="color:#5c2a4d;">Hi {{ guestFirstName }}, thanks for booking at <strong>{{ hotelName }}</strong>.</p>
<p style="background:#f6eef3;padding:12px 16px;border-radius:8px;color:#2a132a;">
  <strong style="display:block;font-size:18px;letter-spacing:0.05em;">{{ code }}</strong>
  {{ arrival }} → {{ departure }} · {{ roomTypeName }}<br>
  Total: <strong>{{ totalAmount }} {{ currency }}</strong>
</p>
<p style="color:#5c2a4d;">To change or cancel, use your code and last name <a href="{{ manageUrl }}" style="color:#5c2a4d;">here</a>.</p>`,
      text: `Booking confirmed — {{ code }}\n\nHi {{ guestFirstName }},\n\nThanks for booking at {{ hotelName }}.\n\nCode: {{ code }}\nCheck-in: {{ arrival }}\nCheck-out: {{ departure }}\nRoom: {{ roomTypeName }}\nTotal: {{ totalAmount }} {{ currency }}\n\nManage: {{ manageUrl }}`,
    },
  },
  reservation_cancelled: {
    es: {
      subject: 'Reserva cancelada {{ code }} — {{ hotelName }}',
      html: `<h2 style="margin:0 0 8px 0;color:#451f3a;">Tu reserva está cancelada</h2>
<p style="color:#5c2a4d;">Hola {{ guestFirstName }}, hemos cancelado tu reserva <strong>{{ code }}</strong> en {{ hotelName }}.</p>
<p style="color:#5c2a4d;">Penalización aplicada: <strong>{{ penalty }} {{ currency }}</strong>.</p>
<p style="color:#5c2a4d;">Si fue un error contacta directamente con el hotel.</p>`,
      text: `Reserva cancelada — {{ code }}\n\nHola {{ guestFirstName }},\n\nHemos cancelado tu reserva {{ code }} en {{ hotelName }}.\nPenalización: {{ penalty }} {{ currency }}.\n\nSi fue un error contacta con el hotel.`,
    },
    en: {
      subject: 'Booking cancelled {{ code }} — {{ hotelName }}',
      html: `<h2 style="margin:0 0 8px 0;color:#451f3a;">Your booking is cancelled</h2>
<p style="color:#5c2a4d;">Hi {{ guestFirstName }}, your booking <strong>{{ code }}</strong> at {{ hotelName }} has been cancelled.</p>
<p style="color:#5c2a4d;">Penalty applied: <strong>{{ penalty }} {{ currency }}</strong>.</p>
<p style="color:#5c2a4d;">If this was a mistake, contact the hotel directly.</p>`,
      text: `Booking cancelled — {{ code }}\n\nHi {{ guestFirstName }},\n\nYour booking {{ code }} at {{ hotelName }} is cancelled.\nPenalty: {{ penalty }} {{ currency }}.`,
    },
  },
  front_desk_new_reservation: {
    es: {
      subject: '🔔 Nueva reserva {{ code }} ({{ source }})',
      html: `<h2 style="margin:0 0 8px 0;color:#451f3a;">Nueva reserva</h2>
<p style="background:#f6eef3;padding:12px 16px;border-radius:8px;color:#2a132a;">
  <strong style="display:block;font-size:18px;">{{ code }}</strong>
  Huésped: {{ guestFirstName }} {{ guestLastName }}<br>
  Origen: {{ source }}<br>
  {{ arrival }} → {{ departure }} · {{ roomTypeName }}<br>
  Total: <strong>{{ totalAmount }} {{ currency }}</strong>
</p>
<p style="color:#5c2a4d;"><a href="{{ backofficeUrl }}" style="color:#5c2a4d;">Abrir en back-office →</a></p>`,
      text: `Nueva reserva — {{ code }}\n\nHuésped: {{ guestFirstName }} {{ guestLastName }}\nOrigen: {{ source }}\n{{ arrival }} → {{ departure }} · {{ roomTypeName }}\nTotal: {{ totalAmount }} {{ currency }}\n\n{{ backofficeUrl }}`,
    },
  },
};
