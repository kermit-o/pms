import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { auth, signOut } from '@/auth';
import './globals.css';

const PAIRING_COOKIE = 'aubergine_pairing';

export const metadata: Metadata = {
  title: {
    default: 'Aubergine Housekeeping',
    template: '%s · Aubergine HSK',
  },
  description: 'Mobile-first PWA for housekeeping operations.',
  appleWebApp: { capable: true, title: 'Aubergine HSK' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#5c2a4d',
};

const NAV_ITEMS: Array<{ href: string; label: string }> = [
  { href: '/', label: 'Tareas' },
  { href: '/lost-found', label: 'Lost & Found' },
  { href: '/supervisor', label: 'Supervisor' },
];

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const jar = await cookies();
  const hasPairing = jar.has(PAIRING_COOKIE);
  const isAuthed = Boolean(session) || hasPairing;

  return (
    <html lang="es">
      <body className="min-h-screen bg-aubergine-50 text-aubergine-900 antialiased">
        {isAuthed && (
          <nav className="sticky top-0 z-30 border-b border-aubergine-100 bg-white/95 backdrop-blur">
            <div className="mx-auto flex max-w-md items-center justify-between gap-2 px-3 py-2">
              <ul className="flex items-center gap-1 text-xs">
                {NAV_ITEMS.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="rounded-md px-2.5 py-1.5 font-medium text-aubergine-700/80 transition hover:bg-aubergine-50 hover:text-aubergine-700"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <form
                action={async () => {
                  'use server';
                  const j = await cookies();
                  const wasPaired = j.has(PAIRING_COOKIE);
                  j.delete(PAIRING_COOKIE);
                  if (wasPaired) return;
                  await signOut({ redirectTo: '/login' });
                }}
              >
                <button
                  type="submit"
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium text-aubergine-700/70 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
                >
                  Salir
                </button>
              </form>
            </div>
          </nav>
        )}
        {children}
      </body>
    </html>
  );
}
