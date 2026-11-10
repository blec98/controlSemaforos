'use client'

import { useEffect, useState } from 'react'
import { MS_SIN_DATOS, SEGUNDOS_DETECCION_CAIDA } from '@/lib/config'
import { hora, NOMBRE_ACCESO, NOMBRE_ETAPA, NOMBRE_MODO, NOMBRE_MOTIVO } from '@/lib/etiquetas'
import { crearClienteNavegador } from '@/lib/supabase/navegador'
import { ACCESOS, type Acceso, type EstadoCruce, type EventoFase } from '@/lib/tipos'
import estilos from './monitoreo.module.css'

type Props = {
  cruceId: string
  nombreCruce: string
  estadoInicial: EstadoCruce | null
  antiguedadInicialMs: number | null
  eventosIniciales: EventoFase[]
}

type Conexion = 'conectando' | 'conectado' | 'caida'

// Misma regla que FTITrafficController.light(): un acceso tiene la luz de la etapa
// si está entre los activos; si no, está en rojo.
function luz(estado: EstadoCruce, acceso: Acceso): 'verde' | 'amarillo' | 'rojo' {
  if (!estado.activos.includes(acceso)) return 'rojo'
  if (estado.etapa === 'GREEN') return 'verde'
  if (estado.etapa === 'YELLOW') return 'amarillo'
  return 'rojo'
}

const TEXTO_LUZ = { verde: 'Verde', amarillo: 'Amarillo', rojo: 'Rojo' }

export function PanelEnVivo({ cruceId, nombreCruce, estadoInicial, antiguedadInicialMs, eventosIniciales }: Props) {
  const [estado, setEstado] = useState(estadoInicial)
  const [eventos, setEventos] = useState(eventosIniciales)
  const [conexion, setConexion] = useState<Conexion>('conectando')
  // Hora local (del navegador) en que llegó el último estado. Se mide con el mismo reloj
  // con que se compara después, así el desfase entre equipos no afecta la alerta.
  const [llegada, setLlegada] = useState(() =>
    antiguedadInicialMs === null ? null : Date.now() - antiguedadInicialMs,
  )
  const [ahora, setAhora] = useState(() => Date.now())

  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(reloj)
  }, [])

  useEffect(() => {
    const supabase = crearClienteNavegador()
    const filtro = `cruce_id=eq.${cruceId}`
    const canal = supabase
      .channel(`monitoreo:${cruceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estado_cruce', filter: filtro }, (cambio) => {
        if (cambio.eventType === 'DELETE') return
        setEstado(cambio.new as EstadoCruce)
        setLlegada(Date.now())
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'eventos_fase', filter: filtro }, (cambio) => {
        setEventos((previos) => [cambio.new as EventoFase, ...previos].slice(0, 15))
      })
      .subscribe((estadoCanal) => {
        if (estadoCanal === 'SUBSCRIBED') setConexion('conectado')
        else if (estadoCanal === 'CHANNEL_ERROR' || estadoCanal === 'TIMED_OUT' || estadoCanal === 'CLOSED') setConexion('caida')
      })
    return () => {
      supabase.removeChannel(canal)
    }
  }, [cruceId])

  const sinDatos = llegada === null || ahora - llegada > MS_SIN_DATOS
  const segundosSinDatos = llegada === null ? null : Math.round((ahora - llegada) / 1000)

  return (
    <div className="grilla">
      <Alertas estado={estado} sinDatos={sinDatos} segundosSinDatos={segundosSinDatos} conexion={conexion} />

      <section className="tarjeta" aria-labelledby="titulo-cruce">
        <div className={estilos.encabezado}>
          <h2 id="titulo-cruce">{nombreCruce}</h2>
          <span className="tenue">
            {conexion === 'conectado' ? 'Tiempo real activo' : conexion === 'conectando' ? 'Conectando tiempo real…' : 'Tiempo real desconectado'}
          </span>
        </div>

        {estado ? (
          <div className={estilos.cruce} aria-live="polite">
            {ACCESOS.map((acceso, i) => {
              const color = luz(estado, acceso)
              const vehiculos = estado.detectados[i] ?? 0
              return (
                <div key={acceso} className={`${estilos.acceso} ${estilos[`acceso${acceso}`]}`} data-atenuado={sinDatos || undefined}>
                  <span className={estilos.nombreAcceso}>{NOMBRE_ACCESO[acceso]}</span>
                  <span className={`chip ${estilos[color]}`}>{TEXTO_LUZ[color]}</span>
                  <span className="tenue num">{vehiculos === 0 ? 'Libre' : `${vehiculos} ${vehiculos === 1 ? 'vehículo' : 'vehículos'}`}</span>
                </div>
              )
            })}
            <dl className={estilos.centro}>
              <dt>Etapa</dt>
              <dd>{NOMBRE_ETAPA[estado.etapa]}</dd>
              <dt>Modo</dt>
              <dd>
                {NOMBRE_MODO[estado.modo_activo]}
                {estado.modo !== estado.modo_activo && <span className="tenue"> (pasando a {NOMBRE_MODO[estado.modo]})</span>}
              </dd>
              {estado.motivo_texto && (
                <>
                  <dt>Controlador</dt>
                  <dd>{estado.motivo_texto}</dd>
                </>
              )}
            </dl>
          </div>
        ) : (
          <p className="tenue">El cruce todavía no ha enviado datos. Cuando Godot envíe su primer latido aparecerá aquí.</p>
        )}

        {estado && (
          <p className="tenue" style={{ marginTop: '1rem', marginBottom: 0, fontSize: '0.85rem' }}>
            Último dato recibido a las {hora(estado.recibido_en)}
          </p>
        )}
      </section>

      <section className="tarjeta" aria-labelledby="titulo-eventos">
        <h2 id="titulo-eventos">Últimos cambios de fase</h2>
        {eventos.length === 0 ? (
          <p className="tenue">Sin cambios registrados.</p>
        ) : (
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr>
                  <th scope="col">Hora</th>
                  <th scope="col">Etapa</th>
                  <th scope="col">Accesos</th>
                  <th scope="col">Motivo del corte</th>
                  <th scope="col">Modo</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((e) => (
                  <tr key={e.id}>
                    <td className="num">{hora(e.ocurrido_en)}</td>
                    <td>{NOMBRE_ETAPA[e.etapa]}</td>
                    <td>{e.activos.length ? e.activos.map((a) => NOMBRE_ACCESO[a]).join(', ') : '—'}</td>
                    <td>{e.motivo ? NOMBRE_MOTIVO[e.motivo] : '—'}</td>
                    <td>
                      {NOMBRE_MODO[e.modo_activo]}
                      {e.respaldo && <span className="tenue"> · respaldo</span>}
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

function Alertas({ estado, sinDatos, segundosSinDatos, conexion }: { estado: EstadoCruce | null; sinDatos: boolean; segundosSinDatos: number | null; conexion: Conexion }) {
  const alertas: { tipo: 'alerta' | 'aviso'; texto: string }[] = []

  if (estado && sinDatos) {
    alertas.push({ tipo: 'alerta', texto: `El cruce no informa hace ${segundosSinDatos} s. Las luces mostradas pueden no ser las actuales.` })
  }
  if (estado?.respaldo) {
    alertas.push({ tipo: 'alerta', texto: 'Respaldo a tiempo fijo activo: el controlador perdió la detección y alterna por ejes.' })
  } else if (estado && estado.edad_sensor > SEGUNDOS_DETECCION_CAIDA) {
    alertas.push({ tipo: 'aviso', texto: `La detección no entrega lecturas hace ${estado.edad_sensor.toFixed(1)} s.` })
  }
  if (conexion === 'caida') {
    alertas.push({ tipo: 'aviso', texto: 'Se perdió la conexión de tiempo real. Recarga la página para reconectar.' })
  }

  if (alertas.length === 0) return null
  return (
    <div role="status">
      {alertas.map((a) => (
        <p key={a.texto} className={`mensaje mensaje-${a.tipo}`} style={{ marginBottom: '0.5rem' }}>
          {a.texto}
        </p>
      ))}
    </div>
  )
}
