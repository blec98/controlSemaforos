'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import { NOMBRE_TIPO_VEHICULO, numero } from '@/lib/etiquetas'
import { TIPOS_VEHICULO, type PorTipo, type TipoVehiculo } from '@/lib/tipos'
import estilos from './estadisticas.module.css'

// Un color por tipo de vehículo, siempre el mismo sin importar el filtro. Son las tres
// primeras posiciones de la paleta categórica validada para daltonismo; el aqua queda
// bajo 3:1 en modo claro, por eso cada gráfico ofrece su tabla de datos.
const COLOR: Record<TipoVehiculo, string> = { auto: 'var(--serie-1)', camioneta: 'var(--serie-2)', bus: 'var(--serie-3)' }

type Props = {
  serie: ({ periodo: string } & PorTipo)[]
  unidad: 'hour' | 'day'
  perfil: ({ hora: number } & PorTipo)[]
}

export function Graficos({ serie, unidad, perfil }: Props) {
  // El perfil solo trae las horas con conteos; se completan las 24 para que el eje no salte.
  const perfilCompleto = Array.from({ length: 24 }, (_, h) => {
    const fila = perfil.find((p) => p.hora === h)
    return { etiqueta: `${String(h).padStart(2, '0')}:00`, auto: fila?.auto ?? 0, camioneta: fila?.camioneta ?? 0, bus: fila?.bus ?? 0 }
  })
  const serieEtiquetada = serie.map((fila) => ({ ...fila, etiqueta: etiquetaPeriodo(fila.periodo, unidad) }))

  return (
    <>
      <Grafico
        titulo={unidad === 'hour' ? 'Vehículos por hora' : 'Vehículos por día'}
        datos={serieEtiquetada}
        columnaEtiqueta={unidad === 'hour' ? 'Hora' : 'Día'}
      />
      <Grafico
        titulo="Perfil por hora del día"
        descripcion="Suma de todos los días del período, para ver en qué horas se concentra la demanda."
        datos={perfilCompleto}
        columnaEtiqueta="Hora"
      />
    </>
  )
}

function etiquetaPeriodo(periodo: string, unidad: 'hour' | 'day') {
  const [fecha, horaMinuto] = periodo.split('T')
  const [, mes, dia] = fecha.split('-')
  return unidad === 'hour' ? `${dia}/${mes} ${horaMinuto}` : `${dia}/${mes}`
}

type Fila = { etiqueta: string } & PorTipo

function Grafico({ titulo, descripcion, datos, columnaEtiqueta }: { titulo: string; descripcion?: string; datos: Fila[]; columnaEtiqueta: string }) {
  return (
    <section className="tarjeta" aria-label={titulo}>
      <h2>{titulo}</h2>
      {descripcion && <p className="tenue" style={{ fontSize: '0.85rem' }}>{descripcion}</p>}
      <ul className={estilos.leyenda} aria-label="Leyenda">
        {TIPOS_VEHICULO.map((t) => (
          <li key={t}>
            <span className={estilos.muestra} style={{ background: COLOR[t] }} aria-hidden="true" />
            {NOMBRE_TIPO_VEHICULO[t]}
          </li>
        ))}
      </ul>
      <div className={estilos.grafico} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--borde)" />
            <XAxis dataKey="etiqueta" tick={{ fill: 'var(--texto-tenue)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--borde)' }} minTickGap={12} />
            <YAxis allowDecimals={false} tick={{ fill: 'var(--texto-tenue)', fontSize: 12 }} tickLine={false} axisLine={false} />
            <Tooltip content={DetalleBarra} cursor={{ fill: 'var(--borde)', opacity: 0.4 }} />
            {TIPOS_VEHICULO.map((t) => (
              // El borde del color de la superficie separa los segmentos apilados.
              <Bar key={t} dataKey={t} name={NOMBRE_TIPO_VEHICULO[t]} stackId="tipos" fill={COLOR[t]} stroke="var(--superficie)" strokeWidth={2} maxBarSize={40} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* El gráfico se oculta al lector de pantalla; esta tabla es su versión accesible. */}
      <details>
        <summary>Ver tabla de datos</summary>
        <div className="tabla-envoltura">
          <table>
            <thead>
              <tr>
                <th scope="col">{columnaEtiqueta}</th>
                {TIPOS_VEHICULO.map((t) => (
                  <th key={t} scope="col" className="num">{NOMBRE_TIPO_VEHICULO[t]}</th>
                ))}
                <th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {datos.map((f) => (
                <tr key={f.etiqueta}>
                  <td>{f.etiqueta}</td>
                  {TIPOS_VEHICULO.map((t) => (
                    <td key={t} className="num">{numero.format(f[t])}</td>
                  ))}
                  <td className="num">{numero.format(f.auto + f.camioneta + f.bus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

function DetalleBarra({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((suma, p) => suma + (Number(p.value) || 0), 0)
  return (
    <div className={estilos.tooltip}>
      <p style={{ fontWeight: 600 }}>{label}</p>
      {[...payload].reverse().map((p) => (
        <p key={String(p.dataKey)}>
          <span className={estilos.muestra} style={{ background: p.color }} aria-hidden="true" />
          {p.name}: <span className="num">{numero.format(Number(p.value) || 0)}</span>
        </p>
      ))}
      <p className="tenue">Total: <span className="num">{numero.format(total)}</span></p>
    </div>
  )
}
