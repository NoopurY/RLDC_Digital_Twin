/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["mongoose"],
  // Retired routes from the earlier navigation point at their new homes.
  async redirects() {
    return [
      { source: "/dashboard", destination: "/simulator", permanent: false },
      { source: "/analysis", destination: "/dsp", permanent: false },
      { source: "/comparison", destination: "/compare", permanent: false },
      { source: "/scenarios", destination: "/experiments", permanent: false },
      { source: "/model", destination: "/architecture", permanent: false },
      { source: "/about", destination: "/architecture", permanent: false },
    ];
  },
};
export default nextConfig;
