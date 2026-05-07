/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone produce un bundle Node minimo en .next/standalone que se copia
  // a la imagen Docker. Sin esto la imagen carga todos los node_modules del
  // workspace en runtime.
  output: 'standalone',
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
