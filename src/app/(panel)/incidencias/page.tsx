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

const LIMITE = 200

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

// Tiempo que lleva esperando, en la unidad que se lee mejor.
function espera(desde: string, ahoraMs: number): string {
  const minutos = Math.max(0, Math.floor((ahoraMs - Date.parse(desde)) / 60000))
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 48) return `${horas} h`
  return `${Math.floor(horas / 24)} días`
}

async function cargar(vista: Vista) {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('incidencias')
    .select('id, tipo, descripcion, estado, foto_path, creada_en, actualizada_en')
    .in('estado', VISTAS[vista].estados)
    // Las pendientes, de la más antigua a la más nueva: se atiende primero lo que lleva más tiempo esperando.
    .order('creada_en', { ascending: vista === 'pendientes' })
    // Se pide una de más para saber si quedaron incidencias fuera de la lista.
    .limit(LIMITE + 1)
  const filas = (data as Incidencia[] | null) ?? []
  return { incidencias: filas.slice(0, LIMITE), hayMas: filas.length > LIMITE, error, ahoraMs: Date.now() }
}

async function Contenido({ searchParams }: { searchParams: Busqueda }) {
  await exigirRol('operador')
  const { vista: pedida } = await searchParams
  // hasOwn y no `in`: `in` también acepta nombres heredados como "toString".
  const vista: Vista = typeof pedida === 'string' && Object.hasOwn(VISTAS, pedida) ? (pedida as Vista) : 'pendientes'
  const { incidencias, hayMas, error, ahoraMs } = await cargar(vista)

  return (
    <div className="grilla">
      <nav className={estilos.vistas} aria-label="Filtrar por estado">
        {(Object.keys(VISTAS) as Vista[]).map((v) => (
          <Link key={v} href={`/incidencias?vista=${v}`} aria-current={v === vista ? 'page' : undefined}>
            {VISTAS[v].texto}
          </Link>
        ))}
      </nav>

      {error ? (
        <p className="mensaje mensaje-alerta" role="alert">
          <strong>Alerta:</strong> no se pudieron cargar las incidencias. Recarga la página para reintentar.
        </p>
      ) : (
        <section className="tarjeta" aria-label={`Incidencias: ${VISTAS[vista].texto.toLowerCase()}`}>
          {hayMas && (
            <p className="mensaje mensaje-aviso">
              <strong>Aviso:</strong> se muestran solo {LIMITE}
              {vista === 'pendientes' ? ', las que llevan más tiempo esperando.' : ', las más recientes.'}
            </p>
          )}
          {incidencias.length === 0 ? (
            <p className="tenue" style={{ margin: 0 }}>No hay incidencias en esta vista.</p>
          ) : (
            <div className="tabla-envoltura" role="region" aria-label="Lista de incidencias" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Tipo</th>
                    <th scope="col">Descripción</th>
                    <th scope="col">Recibida</th>
                    {vista === 'pendientes' && <th scope="col" className="num">Esperando</th>}
                    <th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {incidencias.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link href={`/incidencias/${i.id}`}>
                          {NOMBRE_TIPO_INCIDENCIA[i.tipo]}
                          <span className="solo-lector">, recibida el {fechaHora(i.creada_en)}</span>
                        </Link>
                      </td>
                      <td>
                        <div className={estilos.descripcion}>
                          {i.descripcion}
                          {i.foto_path && <span className="tenue"> · con foto</span>}
                        </div>
                      </td>
                      <td className="num">{fechaHora(i.creada_en)}</td>
                      {vista === 'pendientes' && <td className="num">{espera(i.creada_en, ahoraMs)}</td>}
                      <td>
                        <span className={`chip ${estilos[i.estado]} ${i.estado === 'en_revision' ? 'chip-anillo' : ''}`}>
                          {NOMBRE_ESTADO_INCIDENCIA[i.estado]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
