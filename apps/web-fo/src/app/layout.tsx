import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Aubergine — PMS for boutique hotels',
    template: '%s · Aubergine',
  },
  description: 'AI-native Property Management System for boutique hotels.',
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
