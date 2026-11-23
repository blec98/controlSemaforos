import type { NextConfig } from "next";

const esDesarrollo = process.env.NODE_ENV === "development";

// Supabase es el único origen externo: API REST, Auth, Realtime por WebSocket y las URL
// firmadas de las fotos de incidencias.
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// https → wss y http → ws (este último, para un Supabase local en desarrollo).
const supabaseWs = supabase.replace(/^http(s?):/, "ws$1:");

// CSP sin nonce. La guía de Next 16 indica que los nonces son incompatibles con Partial
// Prerendering (el esqueleto estático no recibe el nonce), y este proyecto lo usa. Por
// eso script-src lleva 'unsafe-inline' para los scripts de arranque de Next: un script
// inyectado inline seguiría corriendo. Lo que sí bloquea: scripts de otros dominios,
// conexiones a cualquier destino que no sea Supabase (sacar datos hacia afuera), iframes,
// <object> y <base>. style-src necesita 'unsafe-inline' por los estilos de Recharts.
// 'unsafe-eval' solo en desarrollo, porque React lo usa para reconstruir errores.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${esDesarrollo ? " 'unsafe-eval'" : ""}`,
  // Aunque script-src permita <script> inline, esto bloquea los manejadores en atributos
  // (por ejemplo, un <img onerror=...> inyectado). React no los usa.
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' blob: data: ${supabase}`,
  "font-src 'self'",
  `connect-src 'self' ${supabase} ${supabaseWs}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // El panel no incrusta páginas ni reproduce audio o video.
  "frame-src 'none'",
  "media-src 'none'",
  // En desarrollo por la red local el panel va por http; forzar https lo rompería.
  ...(esDesarrollo ? [] : ["upgrade-insecure-requests"]),
].join("; ");

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
          { key: "Content-Security-Policy", value: csp },
          // Strict-Transport-Security no va aquí: Vercel ya lo entrega en producción
          // (max-age=63072000; includeSubDomains; preload), verificado con curl -I.
        ],
      },
    ];
  },
};

export default nextConfig;
