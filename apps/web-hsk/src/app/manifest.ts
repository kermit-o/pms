import type { MetadataRoute } from 'next';

/**
 * PWA manifest. Next 15 generates the file at /manifest.webmanifest from
 * this route. Icons + splash screens land in W2 once the brand pass is
 * done; for W1 we ship the bare minimum so the install prompt surfaces.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aubergine Housekeeping',
    short_name: 'Aubergine HSK',
    description: 'Mobile-first PWA for housekeeping operations.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6eef3',
    theme_color: '#5c2a4d',
    orientation: 'portrait',
    icons: [],
  };
}
