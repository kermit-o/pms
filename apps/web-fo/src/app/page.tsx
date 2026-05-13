import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export default async function HomePage() {
  const session = await auth();
  // Home operativa = Calendar (inventario + reservas visibles a la vez).
  // Dashboard sigue accesible vía nav para KPIs.
  redirect(session ? '/calendar' : '/login');
}
