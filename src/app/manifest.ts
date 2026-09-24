import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Runway',
    short_name: 'Runway',
    description: 'Deadlines, notes, and links for Fall 2026.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F6F6F4',
    theme_color: '#000000',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Today', url: '/' },
      { name: 'Calendar', url: '/calendar' },
      { name: 'Paste', url: '/inbox' },
    ],
  };
}
