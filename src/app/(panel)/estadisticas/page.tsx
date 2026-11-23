import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { z } from 'zod'
import { CRUCE_ID } from '@/lib/config'
import { hora, hoyEnChile, NOMBRE_ACCESO, NOMBRE_MOTIVO, NOMBRE_TIPO_VEHICULO, numero, restarDias } from '@/lib/etiquetas'
import { exigirRol } from '@/lib/sesion'
import { crearClienteServidor } from '@/lib/supabase/servidor'
import { ACCESOS, TIPOS_VEHICULO, type Acceso, type Estadisticas, type Motivo, type PorTipo } from '@/lib/tipos'
import { Graficos } from './graficos'
import estilos from './estadisticas.module.css'

export const metadata: Metadata = { title: 'Estadísticas' }

type Busqueda = Promise<Record<string, string | string[] | undefined>>

// Cada filtro se valida por separado: un campo vacío o inválido no debe descartar los
// demás. Antes, elegir "Todos" en acceso enviaba `acceso=` y se perdían las fechas.
const vacioAIndefinido = (v: unknown) => (v === '' || Array.isArray(v) ? undefined : v)
const fecha = z.preprocess(vacioAIndefinido, z.iso.date().optional())
const acceso = z.preprocess(vacioAIndefinido, z.enum(['N', 'E', 'S', 'W']).optional())

const ATAJOS = [
  { texto: 'Hoy', dias: 0 },
  { texto: 'Últimos 7 días', dias: 6 },
  { texto: 'Últimos 30 días', dias: 29 },
]

export default function PaginaEstadisticas({ searchParams }: { searchParams: Busqueda }) {
  return (
    <>
      <h1>Estadísticas de tráfico</h1>
      <Suspense fallback={<p className="tenue">Calculando estadísticas…</p>}>
        <Contenido searchParams={searchParams} />
      </Suspense>
    </>
  )
}

function leerFiltros(params: Record<string, string | string[] | undefined>) {
  const hoy = hoyEnChile()
  const d = fecha.safeParse(params.desde)
  const h = fecha.safeParse(params.hasta)
  const a = acceso.safeParse(params.acceso)
  return {
    hoy,
    // Por defecto, los últimos siete días contando hoy.
    desde: (d.success && d.data) || restarDias(hoy, 6),
    hasta: (h.success && h.data) || hoy,
    acceso: a.success ? (a.data as Acceso | undefined) : undefined,
    invalidos: [!d.success && 'desde', !h.success && 'hasta', !a.success && 'acceso'].filter(Boolean) as string[],
    calculadoEn: new Date().toISOString(),
  }
}

// La función SQL solo devuelve los períodos con conteos. Se completan con ceros para
// que una hora o un día sin vehículos (o con la detección caída) se vea como un hueco.
function completarSerie(serie: Estadisticas['serie'], unidad: Estadisticas['unidad'], desde: string, hasta: string) {
  const porPeriodo = new Map(serie.map((f) => [f.periodo, f]))
  // sv-SE formatea como AAAA-MM-DD HH:MM, el mismo orden que usan los períodos.
  const ahora = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' })
    .format(new Date())
    .replace(' ', 'T')
  const completa: ({ periodo: string } & PorTipo)[] = []
  for (let dia = desde; dia <= hasta; dia = restarDias(dia, -1)) {
    const horas = unidad === 'hour' ? Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`) : ['00:00']
    for (const h of horas) {
      const periodo = `${dia}T${h}`
      if (unidad === 'hour' && periodo > ahora) break
      completa.push(porPeriodo.get(periodo) ?? { periodo, auto: 0, camioneta: 0, bus: 0 })
    }
  }
  return completa
}

async function Contenido({ searchParams }: { searchParams: Busqueda }) {
  await exigirRol('operador', 'analista')
  const filtros = leerFiltros(await searchParams)
  const { hoy, desde, hasta, invalidos, calculadoEn } = filtros
  const accesoElegido = filtros.acceso

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('estadisticas_trafico', {
    p_cruce: CRUCE_ID,
    p_desde: desde,
    p_hasta: hasta,
    p_acceso: accesoElegido ?? null,
  })
  const datos = data as Estadisticas | null

  return (
    <div className="grilla">
      <div className={estilos.filtros}>
        <nav aria-label="Períodos rápidos" className={estilos.atajos}>
          {ATAJOS.map(({ texto, dias }) => {
            const desdeAtajo = restarDias(hoy, dias)
            const activo = desde === desdeAtajo && hasta === hoy
            const query = new URLSearchParams({ desde: desdeAtajo, hasta: hoy, ...(accesoElegido ? { acceso: accesoElegido } : {}) })
            return (
              <Link key={texto} href={`/estadisticas?${query}`} aria-current={activo ? 'true' : undefined}>
                {texto}
              </Link>
            )
          })}
        </nav>
        <form method="get" className={estilos.formulario}>
          <div>
            <label htmlFor="desde">Desde</label>
            <input id="desde" name="desde" type="date" defaultValue={desde} max={hoy} />
          </div>
          <div>
            <label htmlFor="hasta">Hasta</label>
            <input id="hasta" name="hasta" type="date" defaultValue={hasta} max={hoy} />
          </div>
          <div>
            <label htmlFor="acceso">Acceso</label>
            <select id="acceso" name="acceso" defaultValue={accesoElegido ?? ''}>
              <option value="">Todos</option>
              {ACCESOS.map((a) => (
                <option key={a} value={a}>
                  {NOMBRE_ACCESO[a]}
                </option>
              ))}
            </select>
          </div>
          <button className="boton boton-principal" type="submit">Aplicar</button>
        </form>
        <p className="nota">
          Datos calculados a las <span className="num">{hora(calculadoEn)}</span> · para actualizarlos, vuelve a aplicar el filtro
        </p>
      </div>

      {invalidos.length > 0 && (
        <p className="mensaje mensaje-aviso">
          <strong>Aviso:</strong> el filtro {invalidos.join(' y ')} no era válido; se usó el valor por defecto.
        </p>
      )}
      {error || !datos ? (
        // Los errores de rango vienen redactados desde la función SQL; los demás no se muestran tal cual.
        <p className="mensaje mensaje-alerta" role="alert">
          {error?.code === '22023' ? error.message : 'No se pudieron calcular las estadísticas. Intenta de nuevo.'}
        </p>
      ) : (
        <Resultados
          datos={{ ...datos, serie: completarSerie(datos.serie, datos.unidad, desde, hasta) }}
          filtradoPorAcceso={Boolean(accesoElegido)}
        />
      )}
    </div>
  )
}

function Resultados({ datos, filtradoPorAcceso }: { datos: Estadisticas; filtradoPorAcceso: boolean }) {
  const totalCortes = Object.values(datos.cortes).reduce((suma, n) => suma + (n ?? 0), 0)
  const sinDemanda = datos.cortes.sin_demanda ?? 0
  const porcentaje = totalCortes ? Math.round((sinDemanda / totalCortes) * 100) : null

  return (
    <>
      <section className={estilos.cifras} aria-label="Resumen del período">
        <div>
          <p className={estilos.cifra}>{numero.format(datos.total)}</p>
          <p className="nota">Vehículos contados{filtradoPorAcceso && ' en el acceso'}</p>
        </div>
        <div>
          <p className={estilos.cifra}>{numero.format(sinDemanda)}</p>
          <p className="nota">Verdes cortados por falta de demanda</p>
        </div>
        <div>
          <p className={estilos.cifra}>{porcentaje === null ? '—' : `${porcentaje} %`}</p>
          <p className="nota">de los {numero.format(totalCortes)} cortes de verde fueron sin demanda</p>
        </div>
      </section>

      {datos.total === 0 ? (
        <p className="tenue">No hay conteos en el período elegido.</p>
      ) : (
        <Graficos serie={datos.serie} unidad={datos.unidad} perfil={datos.perfil_horario} />
      )}

      <div className={estilos.dosColumnas}>
        <section className="tarjeta" aria-labelledby="titulo-totales">
          <h2 id="titulo-totales">Totales del período</h2>
          <table>
            <caption className="solo-lector">Vehículos por acceso</caption>
            <thead>
              <tr>
                <th scope="col">Acceso</th>
                <th scope="col" className="num">Vehículos</th>
              </tr>
            </thead>
            <tbody>
              {ACCESOS.filter((a) => !filtradoPorAcceso || datos.por_acceso[a]).map((a) => (
                <tr key={a}>
                  <td>{NOMBRE_ACCESO[a]}</td>
                  <td className="num">{numero.format(datos.por_acceso[a] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className={estilos.siguiente}>
            <caption className="solo-lector">Vehículos por tipo</caption>
            <thead>
              <tr>
                <th scope="col">Tipo de vehículo</th>
                <th scope="col" className="num">Vehículos</th>
              </tr>
            </thead>
            <tbody>
              {TIPOS_VEHICULO.map((t) => (
                <tr key={t}>
                  <td>{NOMBRE_TIPO_VEHICULO[t]}</td>
                  <td className="num">{numero.format(datos.por_tipo[t] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="tarjeta" aria-labelledby="titulo-cortes">
          <h2 id="titulo-cortes">Cortes de verde por motivo</h2>
          <p className="nota">Corresponden al cruce completo, aunque se filtre un acceso.</p>
          {totalCortes === 0 ? (
            <p className="tenue">Sin cortes registrados en el período.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Motivo</th>
                  <th scope="col" className="num">Cortes</th>
                </tr>
              </thead>
              <tbody>
                {(Object.entries(datos.cortes) as [Motivo | 'sin_motivo', number][])
                  .sort((a, b) => b[1] - a[1])
                  .map(([motivo, n]) => (
                    <tr key={motivo}>
                      <td>{NOMBRE_MOTIVO[motivo]}</td>
                      <td className="num">{numero.format(n)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  )
}
