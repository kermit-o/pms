import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-aubergine-50 text-aubergine-900 antialiased">
        {children}
      </body>
    </html>
  );
}
