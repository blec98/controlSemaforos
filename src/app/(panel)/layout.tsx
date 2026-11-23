import { Suspense } from 'react'
import { cerrarSesion } from '@/app/acciones-sesion'
import { obtenerUsuario } from '@/lib/sesion'
import { crearClienteServidor } from '@/lib/supabase/servidor'
import type { Rol } from '@/lib/tipos'
import { EnlacesNav } from './enlaces-nav'

const SECCIONES: { href: string; texto: string; roles: Rol[] }[] = [
  { href: '/monitoreo', texto: 'Monitoreo', roles: ['operador', 'analista'] },
  { href: '/estadisticas', texto: 'Estadísticas', roles: ['operador', 'analista'] },
  { href: '/incidencias', texto: 'Incidencias', roles: ['operador'] },
]

const NOMBRE_ROL: Record<Rol, string> = { operador: 'Operador', analista: 'Analista', ciudadano: 'Ciudadano' }

export default function LayoutPanel({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="barra">
        <a href="#contenido" className="saltar">Saltar al contenido</a>
        <span className="marca">Control de tránsito</span>
        {/* La navegación depende del rol, que sale de la sesión: va detrás de Suspense
            para que el resto de la página no espere esa lectura. */}
        <Suspense fallback={<nav className="nav" aria-label="Secciones" />}>
          <Navegacion />
        </Suspense>
      </header>
      <main id="contenido" className="contenido" tabIndex={-1}>
        {children}
      </main>
    </>
  )
}

async function Navegacion() {
  const usuario = await obtenerUsuario()
  const visibles = SECCIONES.filter((s) => s.roles.includes(usuario.rol))

  // El operador ve en el menú cuántas incidencias esperan atención, sin entrar a la lista.
  let pendientes = 0
  if (usuario.rol === 'operador') {
    const supabase = await crearClienteServidor()
    const { count } = await supabase
      .from('incidencias')
      .select('id', { count: 'exact', head: true })
      .in('estado', ['recibida', 'en_revision'])
    pendientes = count ?? 0
  }

  return (
    <>
      <nav className="nav" aria-label="Secciones">
        <EnlacesNav
          enlaces={visibles.map(({ href, texto }) => ({ href, texto, pendientes: href === '/incidencias' ? pendientes : 0 }))}
        />
      </nav>
      <div className="usuario">
        <span className="tenue">
          {usuario.nombre ?? usuario.email} · {NOMBRE_ROL[usuario.rol]}
        </span>
        <form action={cerrarSesion}>
          <button className="boton-enlace" type="submit">Salir</button>
        </form>
      </div>
    </>
  )
}
