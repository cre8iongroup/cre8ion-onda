/** @type {import('next').NextConfig} */
import withPWA from 'next-pwa'

const isDev = process.env.NODE_ENV === 'development'

const pwaConfig = withPWA({
  dest: 'public',
  disable: isDev,
  register: true,
  skipWaiting: true,
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/.*\.firebaseio\.com\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'firebase-rtdb',
        networkTimeoutSeconds: 4,
      },
    },
    {
      urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts',
        expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
      },
    },
    {
      urlPattern: /\.(?:js|css|woff2|png|jpg|svg|ico)$/i,
      handler: 'StaleWhileRevalidate',
      options: { cacheName: 'static-assets' },
    },
    {
      urlPattern: /^https?.*/,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'pages',
        networkTimeoutSeconds: 10,
      },
    },
  ],
})

const nextConfig = {
  // Next.js 16+: moved from experimental.serverComponentsExternalPackages
  serverExternalPackages: ['firebase-admin'],

  // Next.js 16 uses Turbopack by default — declare empty config to silence
  // the webpack-vs-turbopack warning surfaced by next-pwa's webpack plugin.
  turbopack: {},

  async headers() {
    return [
      {
        source: '/api/recall/webhook',
        headers: [
          { key: 'Access-Control-Allow-Origin',  value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, x-recall-secret' },
        ],
      },
    ]
  },
}

export default pwaConfig(nextConfig)
