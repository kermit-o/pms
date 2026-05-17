import { renderReservationsList } from '@/components/ReservationsListPage';

export const dynamic = 'force-dynamic';

export default async function InHousePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return renderReservationsList({
    searchParams,
    title: 'In-house',
    basePath: '/in-house',
    preset: { status: 'CHECKED_IN' },
    emptyMessage: 'Sin huéspedes alojados ahora mismo.',
  });
}
