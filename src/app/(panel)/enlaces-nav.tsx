'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Enlace = { href: string; texto: string; pendientes: number }

export function EnlacesNav({ enlaces }: { enlaces: Enlace[] }) {
  const ruta = usePathname()
  return enlaces.map(({ href, texto, pendientes }) => (
    <Link key={href} href={href} aria-current={ruta.startsWith(href) ? 'page' : undefined}>
      {texto}
      {pendientes > 0 && (
        <span className="contador num">
          {pendientes}
          <span className="solo-lector"> pendientes</span>
        </span>
      )}
    </Link>
  ))
}
