'use client';

import { useEffect, useId, useRef } from 'react';

/**
 * Widget Cloudflare Turnstile (Sprint 9 W4 — anti-abuso).
 *
 * Sin dep npm — el script oficial CF carga desde
 * https://challenges.cloudflare.com/turnstile/v0/api.js y se monta sobre un
 * div con la clase `cf-turnstile`. CF inyecta un input hidden con el nombre
 * que indiquemos (default `cf-turnstile-response`), que el formulario envía
 * en el POST. Nosotros usamos `name="turnstileToken"` para que coincida con
 * el DTO del API.
 *
 * Si `siteKey` está vacío, el componente no monta nada y el server-side hace
 * skip (TURNSTILE_SECRET_KEY ausente). Esto mantiene el dev local sin
 * captcha sin tocar código.
 */
interface Props {
  siteKey: string | undefined;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'flexible' | 'compact';
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; theme?: string; size?: string; 'response-field-name'?: string },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

export function Turnstile({ siteKey, theme = 'auto', size = 'flexible' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const id = useId();

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;

    const mount = () => {
      if (!window.turnstile || !containerRef.current) return;
      if (widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme,
        size,
        'response-field-name': 'turnstileToken',
      });
    };

    if (window.turnstile) {
      mount();
    } else if (!document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
      const s = document.createElement('script');
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = mount;
      document.head.appendChild(s);
    } else {
      const i = window.setInterval(() => {
        if (window.turnstile) {
          window.clearInterval(i);
          mount();
        }
      }, 150);
      return () => window.clearInterval(i);
    }

    return () => {
      const w = widgetIdRef.current;
      if (w && window.turnstile) {
        try {
          window.turnstile.remove(w);
        } catch {
          /* ignored */
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, theme, size]);

  if (!siteKey) return null;
  return <div id={`turnstile-${id}`} ref={containerRef} className="my-2" />;
}
