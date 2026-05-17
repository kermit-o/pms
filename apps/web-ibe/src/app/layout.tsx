import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Aubergine — reserva directa',
    template: '%s · Aubergine',
  },
  description: 'Reserva directa en tu hotel boutique al mejor precio.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#5c2a4d',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="flex min-h-screen flex-col antialiased">{children}</body>
    </html>
  );
}
