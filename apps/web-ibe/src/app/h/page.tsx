import { redirect } from 'next/navigation';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function HSplashPage({ searchParams }: Props) {
  const params = await searchParams;
  if (params.slug) {
    redirect(`/h/${encodeURIComponent(params.slug)}`);
  }
  redirect('/');
}
