import { renderReservationsList } from '@/components/ReservationsListPage';

export const dynamic = 'force-dynamic';

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return renderReservationsList({
    searchParams,
    title: 'Reservas',
    basePath: '/reservations',
    preset: {},
  });
}
