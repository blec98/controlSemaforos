import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Control de tránsito', template: '%s · Control de tránsito' },
  description: 'Panel del semáforo inteligente: monitoreo en vivo, estadísticas e incidencias.',
  // Es un panel interno: no tiene sentido que lo indexe un buscador.
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-CL">
      <body>{children}</body>
    </html>
  )
}
