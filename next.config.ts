import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: { position: 'bottom-right' },
  // xlsx and pg are server-only Node packages
  serverExternalPackages: ['pg', 'xlsx'],
};

export default nextConfig;
