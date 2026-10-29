'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function EnlacesNav({ enlaces }: { enlaces: { href: string; texto: string }[] }) {
  const ruta = usePathname()
  return enlaces.map(({ href, texto }) => (
    <Link key={href} href={href} aria-current={ruta.startsWith(href) ? 'page' : undefined}>
      {texto}
    </Link>
  ))
}
