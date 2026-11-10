import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Solo afecta a `next dev`. iniciar-red.bat pone aquí la IP de este equipo para que
  // Next acepte la recarga en caliente desde otros dispositivos de la red local.
  allowedDevOrigins: process.env.ORIGENES_DEV ? process.env.ORIGENES_DEV.split(",") : [],
  async redirects() {
    return [{ source: "/", destination: "/monitoreo", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // El panel no se debe poder incrustar en otro sitio (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
