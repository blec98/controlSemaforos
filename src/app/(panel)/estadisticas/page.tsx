import type { Metadata } from 'next'
import { Suspense } from 'react'
import { z } from 'zod'
import { CRUCE_ID } from '@/lib/config'
import { hoyEnChile, NOMBRE_ACCESO, NOMBRE_MOTIVO, NOMBRE_TIPO_VEHICULO, numero, restarDias } from '@/lib/etiquetas'
import { exigirRol } from '@/lib/sesion'
import { crearClienteServidor } from '@/lib/supabase/servidor'
import { ACCESOS, TIPOS_VEHICULO, type Estadisticas, type Motivo } from '@/lib/tipos'
import { Graficos } from './graficos'
import estilos from './estadisticas.module.css'

export const metadata: Metadata = { title: 'Estadísticas' }

type Busqueda = Promise<Record<string, string | string[] | undefined>>

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const filtros = z.object({
  desde: fecha.optional(),
  hasta: fecha.optional(),
  acceso: z.enum(['N', 'E', 'S', 'W']).optional(),
})

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

async function Contenido({ searchParams }: { searchParams: Busqueda }) {
  await exigirRol('operador', 'analista')
  const leidos = filtros.safeParse(await searchParams)
  const hoy = hoyEnChile()
  // Por defecto, los últimos siete días contando hoy.
  const desde = (leidos.success && leidos.data.desde) || restarDias(hoy, 6)
  const hasta = (leidos.success && leidos.data.hasta) || hoy
  const acceso = leidos.success ? leidos.data.acceso : undefined

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('estadisticas_trafico', {
    p_cruce: CRUCE_ID,
    p_desde: desde,
    p_hasta: hasta,
    p_acceso: acceso ?? null,
  })

  return (
    <div className="grilla">
      <form className={`tarjeta ${estilos.filtros}`} method="get">
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
          <select id="acceso" name="acceso" defaultValue={acceso ?? ''}>
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

      {!leidos.success && <p className="mensaje mensaje-aviso">Algún filtro no era válido; se usaron los valores por defecto.</p>}
      {error ? (
        // Los errores de rango vienen redactados desde la función SQL; los demás no se muestran tal cual.
        <p className="mensaje mensaje-alerta" role="alert">
          {error.code === '22023' ? error.message : 'No se pudieron calcular las estadísticas. Intenta de nuevo.'}
        </p>
      ) : (
        <Resultados datos={data as Estadisticas} filtradoPorAcceso={Boolean(acceso)} />
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
        <div className="tarjeta">
          <p className={estilos.cifra}>{numero.format(datos.total)}</p>
          <p className="tenue">Vehículos contados{filtradoPorAcceso && ' en el acceso'}</p>
        </div>
        <div className="tarjeta">
          <p className={estilos.cifra}>{numero.format(sinDemanda)}</p>
          <p className="tenue">Verdes cortados por falta de demanda</p>
        </div>
        <div className="tarjeta">
          <p className={estilos.cifra}>{porcentaje === null ? '—' : `${porcentaje} %`}</p>
          <p className="tenue">de los {numero.format(totalCortes)} cortes de verde fueron sin demanda</p>
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
          <table style={{ marginTop: '1rem' }}>
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
          <p className="tenue" style={{ fontSize: '0.85rem' }}>Corresponden al cruce completo, aunque se filtre un acceso.</p>
          {totalCortes === 0 ? (
            <p className="tenue">Sin cortes registrados en el período.</p>
          ) : (
            <table>
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
