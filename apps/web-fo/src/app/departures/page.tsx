import { renderReservationsList } from '@/components/ReservationsListPage';

export const dynamic = 'force-dynamic';

export default async function DeparturesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return renderReservationsList({
    searchParams,
    title: 'Salidas de hoy',
    basePath: '/departures',
    preset: {
      departureFrom: today,
      departureTo: today,
      status: 'CHECKED_IN,CHECKED_OUT',
    },
    emptyMessage: 'Sin salidas previstas hoy.',
  });
}
