export default function manifest() {
  return {
    name: 'Food Rescue Hubballi',
    short_name: 'Food Rescue',
    description: 'Surplus food from hotels and mess halls to NGOs, delivered by volunteers.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f6f7f5',
    theme_color: '#1a7d4e',
    categories: ['food', 'social', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    shortcuts: [
      { name: 'Post surplus food', url: '/donor/post', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'My tasks', url: '/volunteer', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
