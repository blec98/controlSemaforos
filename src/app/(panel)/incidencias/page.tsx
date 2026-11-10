import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { fechaHora, NOMBRE_ESTADO_INCIDENCIA, NOMBRE_TIPO_INCIDENCIA } from '@/lib/etiquetas'
import { exigirRol } from '@/lib/sesion'
import { crearClienteServidor } from '@/lib/supabase/servidor'
import type { EstadoIncidencia, Incidencia } from '@/lib/tipos'
import estilos from './incidencias.module.css'

export const metadata: Metadata = { title: 'Incidencias' }

type Busqueda = Promise<Record<string, string | string[] | undefined>>

const VISTAS = {
  pendientes: { texto: 'Pendientes', estados: ['recibida', 'en_revision'] },
  resueltas: { texto: 'Resueltas', estados: ['resuelta'] },
  todas: { texto: 'Todas', estados: ['recibida', 'en_revision', 'resuelta'] },
} satisfies Record<string, { texto: string; estados: EstadoIncidencia[] }>

type Vista = keyof typeof VISTAS

export default function PaginaIncidencias({ searchParams }: { searchParams: Busqueda }) {
  return (
    <>
      <h1>Incidencias reportadas</h1>
      <Suspense fallback={<p className="tenue">Cargando incidencias…</p>}>
        <Contenido searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function Contenido({ searchParams }: { searchParams: Busqueda }) {
  await exigirRol('operador')
  const { vista: pedida } = await searchParams
  const vista: Vista = typeof pedida === 'string' && pedida in VISTAS ? (pedida as Vista) : 'pendientes'

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('incidencias')
    .select('id, tipo, descripcion, estado, foto_path, creada_en, actualizada_en')
    .in('estado', VISTAS[vista].estados)
    // Las pendientes, de la más antigua a la más nueva: se atiende primero lo que lleva más tiempo esperando.
    .order('creada_en', { ascending: vista === 'pendientes' })
    .limit(200)

  const incidencias = (data as Incidencia[] | null) ?? []

  return (
    <div className="grilla">
      <nav className={estilos.vistas} aria-label="Filtrar por estado">
        {(Object.keys(VISTAS) as Vista[]).map((v) => (
          <Link key={v} href={`/incidencias?vista=${v}`} aria-current={v === vista ? 'page' : undefined}>
            {VISTAS[v].texto}
          </Link>
        ))}
      </nav>

      {error && <p className="mensaje mensaje-alerta" role="alert">No se pudieron cargar las incidencias.</p>}

      <section className="tarjeta">
        {incidencias.length === 0 ? (
          <p className="tenue" style={{ margin: 0 }}>No hay incidencias en esta vista.</p>
        ) : (
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr>
                  <th scope="col">Recibida</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Descripción</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {incidencias.map((i) => (
                  <tr key={i.id}>
                    <td className="num">
                      <Link href={`/incidencias/${i.id}`}>{fechaHora(i.creada_en)}</Link>
                    </td>
                    <td>{NOMBRE_TIPO_INCIDENCIA[i.tipo]}</td>
                    <td className={estilos.descripcion}>
                      {i.descripcion}
                      {i.foto_path && <span className="tenue"> · con foto</span>}
                    </td>
                    <td>
                      <span className={`chip ${estilos[i.estado]}`}>{NOMBRE_ESTADO_INCIDENCIA[i.estado]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
