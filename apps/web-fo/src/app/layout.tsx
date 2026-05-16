import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { auth, signOut } from '@/auth';
import CopilotSidebar from '@/components/CopilotSidebar';
import PropertyPicker from '@/components/PropertyPicker';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Aubergine — PMS for boutique hotels',
    template: '%s · Aubergine',
  },
  description: 'AI-native Property Management System for boutique hotels.',
};

const NAV_ITEMS: Array<{ href: string; label: string }> = [
  { href: '/calendar', label: 'Calendario' },
  { href: '/reservations', label: 'Reservas' },
  { href: '/arrivals', label: 'Llegadas' },
  { href: '/departures', label: 'Salidas' },
  { href: '/in-house', label: 'In-house' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/rooms', label: 'Habitaciones' },
  { href: '/guests', label: 'Cardex' },
  { href: '/business-day', label: 'Cierre día' },
  { href: '/night-audit', label: 'Night audit' },
  { href: '/night-audit/anomalies', label: 'Anomalías' },
  { href: '/dashboard/forecast', label: 'Forecast' },
  { href: '/reports', label: 'Reportes' },
];

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  return (
    <html lang="es">
      <body className="min-h-screen bg-aubergine-50 text-aubergine-900 antialiased">
        {session && (
          <nav className="sticky top-0 z-30 border-b border-aubergine-100 bg-white/90 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
              <Link
                href="/dashboard"
                className="text-sm font-semibold uppercase tracking-[0.2em] text-aubergine-700"
              >
                Aubergine
              </Link>
              <ul className="flex flex-1 flex-wrap items-center gap-1 text-sm">
                {NAV_ITEMS.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="rounded-md px-3 py-1.5 text-aubergine-700/80 transition hover:bg-aubergine-50 hover:text-aubergine-700"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <PropertyPicker />
              <form
                action={async () => {
                  'use server';
                  await signOut({ redirectTo: '/login' });
                }}
              >
                <button
                  type="submit"
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-aubergine-700/70 ring-1 ring-aubergine-100 hover:bg-aubergine-50"
                >
                  Salir
                </button>
              </form>
            </div>
          </nav>
        )}
        {children}
        {session && <CopilotSidebar />}
      </body>
    </html>
  );
}
