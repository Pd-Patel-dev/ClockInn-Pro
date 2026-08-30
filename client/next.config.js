/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  },
  async redirects() {
    return [
      { source: '/admin/cash', destination: '/admin/drawer-log', permanent: true },
      { source: '/admin/cash-management', destination: '/admin/drawer-log', permanent: true },
      { source: '/admin/shift-log', destination: '/admin/drawer-log', permanent: true },
      { source: '/drawer-log', destination: '/admin/drawer-log', permanent: true },
      { source: '/shift-notes', destination: '/dashboard', permanent: true },
      { source: '/admin/common-log', destination: '/dashboard', permanent: true },
      { source: '/my/shift-notepad', destination: '/dashboard', permanent: true },
      { source: '/time-entries', destination: '/admin/punch-log', permanent: true },
      { source: '/employees/new', destination: '/employees/create', permanent: false },
    ]
  },
  async rewrites() {
    return [{ source: '/favicon.ico', destination: '/favicon.svg' }]
  },
  // Enable fast refresh and hot reload
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      // Force polling for better file watching (especially on Windows/WSL)
      // This ensures files are detected when saved
      config.watchOptions = {
        poll: 1000, // Check for file changes every second (Windows-friendly)
        aggregateTimeout: 200, // Shorter delay before rebuilding
        ignored: ['**/node_modules/**', '**/.git/**', '**/.next/**'], // Ignore these
        followSymlinks: false,
      }
    }
    return config
  },
  // Ensure Fast Refresh is enabled
  experimental: {
    // Fast Refresh is enabled by default in Next.js
  },
}

module.exports = nextConfig

