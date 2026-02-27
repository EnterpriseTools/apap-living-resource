/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: '/analysis', destination: '/overview', permanent: true },
      { source: '/cohorts', destination: '/overview', permanent: true },
    ];
  },
}

module.exports = nextConfig

