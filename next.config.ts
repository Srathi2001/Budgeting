import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Azure: a self-contained server (.next/standalone, started with `node server.js`); the deployment
  // copies public/, .next/static/ and drizzle/ next to it (.github/workflows/deploy-azure.yml). Local
  // builds are unchanged.
  ...(process.env.BUILD_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  devIndicators: { position: 'bottom-right' },
  // xlsx and pg are server-only Node packages
  serverExternalPackages: ['pg', 'xlsx'],
  // the Tenant and Lease Details Report export is over 1 MB (the default limit for uploads to server actions)
  experimental: { serverActions: { bodySizeLimit: '25mb' } },
};

export default nextConfig;
