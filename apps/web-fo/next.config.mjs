/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone produce un bundle Node minimo (~50 MB) en .next/standalone que
  // se copia a la imagen Docker. Sin esto la imagen tiene que cargar todos
  // los node_modules del workspace en runtime.
  output: 'standalone',
  // En un monorepo pnpm, Next traza desde el root para incluir los packages
  // workspace correctamente.
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
