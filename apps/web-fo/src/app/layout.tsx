import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { auth } from '@/auth';
import CopilotSidebar from '@/components/CopilotSidebar';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Aubergine — PMS for boutique hotels',
    template: '%s · Aubergine',
  },
  description: 'AI-native Property Management System for boutique hotels.',
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  return (
    <html lang="es">
      <body className="min-h-screen bg-aubergine-50 text-aubergine-900 antialiased">
        {children}
        {session && <CopilotSidebar />}
      </body>
    </html>
  );
}
