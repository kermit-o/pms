import { renderReservationsList } from '@/components/ReservationsListPage';

export const dynamic = 'force-dynamic';

export default async function ArrivalsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return renderReservationsList({
    searchParams,
    title: 'Llegadas de hoy',
    basePath: '/arrivals',
    preset: {
      arrivalFrom: today,
      arrivalTo: today,
      status: 'PENDING,CONFIRMED,CHECKED_IN',
    },
    emptyMessage: 'Sin llegadas previstas hoy.',
  });
}
