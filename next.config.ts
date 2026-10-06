import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: { position: 'bottom-right' },
  // xlsx and pg are server-only Node packages
  serverExternalPackages: ['pg', 'xlsx'],
  // the Tenant and Lease Details Report export is over 1 MB (the default limit for uploads to server actions)
  experimental: { serverActions: { bodySizeLimit: '25mb' } },
};

export default nextConfig;
