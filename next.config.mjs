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
      { source: "/fault-lab", destination: "/simulator", permanent: false },
      { source: "/experiments", destination: "/simulator", permanent: false },
      { source: "/scenarios", destination: "/simulator", permanent: false },
      { source: "/architecture", destination: "/simulator", permanent: false },
      { source: "/model", destination: "/simulator", permanent: false },
      { source: "/about", destination: "/simulator", permanent: false },
    ];
  },
};
export default nextConfig;
