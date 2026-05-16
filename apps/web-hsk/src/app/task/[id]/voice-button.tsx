'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseRoomStatusKeyword, type RoomStatusKeyword } from './voice-keywords';

/**
 * Voice-first input para HSK (Sprint 6 W3).
 *
 * Usa Web Speech API (SpeechRecognition / webkitSpeechRecognition) en el
 * propio browser — el audio NO sale del dispositivo. Si el browser no
 * soporta la API, el componente devuelve null y el formulario funciona
 * como antes (teclado).
 *
 * Comportamiento:
 *  - Boton flotante (fixed bottom-6 right-6) muy grande para usar con
 *    guante o manos ocupadas.
 *  - Al pulsar: inicia continuous=true + interim=true. El icono pulsa
 *    mientras escucha.
 *  - Cada result final dispara onTranscript(text). Si el text contiene
 *    una palabra-clave de estado, ademas dispara onStatusKeyword.
 *
 * El consumer decide que hacer con el transcript (lo solemos pegar al
 * campo notas) y con el keyword (auto-seleccionar el room status).
 */
interface Props {
  onTranscript: (text: string) => void;
  onStatusKeyword?: (status: RoomStatusKeyword) => void;
}

export function VoiceButton({ onTranscript, onStatusKeyword }: Props) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Usamos any para SpeechRecognitionEvent porque los tipos varian entre
  // navegadores (webkit prefix). El runtime es identico.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const Ctor =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSupported(Boolean(Ctor));
  }, []);

  const start = useCallback(() => {
    setError(null);
    setInterim('');
    const Ctor =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'es-ES';
    rec.continuous = true;
    rec.interimResults = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = (result[0]?.transcript ?? '').trim();
        if (result.isFinal) {
          if (text) {
            onTranscript(text);
            const status = parseRoomStatusKeyword(text);
            if (status && onStatusKeyword) onStatusKeyword(status);
          }
        } else {
          interimText += text + ' ';
        }
      }
      setInterim(interimText.trim());
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (event: any) => {
      const code = String(event?.error ?? 'unknown');
      // 'no-speech' es benigno (silencio prolongado); no lo mostramos.
      if (code !== 'no-speech') setError(`Voz: ${code}`);
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [onStatusKeyword, onTranscript]);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  if (!supported) return null;

  return (
    <>
      <button
        type="button"
        onClick={listening ? stop : start}
        aria-label={listening ? 'Detener dictado' : 'Dictar nota por voz'}
        className={`fixed bottom-6 right-6 z-40 flex h-16 w-16 items-center justify-center rounded-full shadow-lg ring-4 transition-all ${
          listening
            ? 'animate-pulse bg-rose-600 text-white ring-rose-200'
            : 'bg-aubergine-600 text-white ring-aubergine-200'
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-8 w-8"
        >
          <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z" />
          <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V21h-2a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.07A7 7 0 0 0 19 11Z" />
        </svg>
      </button>
      {(listening || error) && (
        <div className="fixed bottom-24 right-6 z-40 max-w-xs rounded-xl bg-aubergine-700 px-3 py-2 text-xs text-white shadow-lg">
          {error
            ? error
            : interim
              ? `Escuchando: "${interim}"`
              : 'Escuchando… di "limpia", "sucia", "averia"…'}
        </div>
      )}
    </>
  );
}
