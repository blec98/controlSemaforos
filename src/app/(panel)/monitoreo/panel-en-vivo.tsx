'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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

type Conexion = 'conectando' | 'conectado' | 'reconectando'

// Si el tiempo real no trae nada en este plazo, el panel consulta la base directamente.
// Así sigue leyendo aunque el canal quede en silencio o se corte (el síntoma era tener
// que reiniciar para que "la web comenzara a leer").
const MS_SONDEO = 3000
const MS_RECONEXION_MAX = 30000
const COLUMNAS_EVENTO = 'id, ocurrido_en, etapa, activos, modo_activo, respaldo, motivo'

// Misma regla que FTITrafficController.light(): un acceso tiene la luz de la etapa
// si está entre los activos; si no, está en rojo.
function luz(estado: EstadoCruce, acceso: Acceso): 'verde' | 'amarillo' | 'rojo' {
  if (!estado.activos.includes(acceso)) return 'rojo'
  if (estado.etapa === 'GREEN') return 'verde'
  if (estado.etapa === 'YELLOW') return 'amarillo'
  return 'rojo'
}

const TEXTO_LUZ = { verde: 'Verde', amarillo: 'Amarillo', rojo: 'Rojo' }

// "7588 s" no se lee de un vistazo: sobre el minuto se pasa a minutos, horas o días.
function duracion(segundos: number): string {
  if (segundos < 60) return `${segundos} s`
  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 48) return `${horas} h ${minutos % 60} min`
  return `${Math.floor(horas / 24)} días`
}

function resumen(estado: EstadoCruce | null): string {
  if (!estado) return ''
  const activos = estado.activos.map((a) => NOMBRE_ACCESO[a]).join(' y ')
  if (estado.etapa === 'ALL_RED' || !activos) return 'Todo rojo en el cruce.'
  return `${NOMBRE_ETAPA[estado.etapa]} para ${activos}.`
}

export function PanelEnVivo({ cruceId, nombreCruce, estadoInicial, antiguedadInicialMs, eventosIniciales }: Props) {
  const [estado, setEstado] = useState(estadoInicial)
  const [eventos, setEventos] = useState(eventosIniciales)
  const [conexion, setConexion] = useState<Conexion>('conectando')
  // Sube en uno para forzar una suscripción nueva después de un corte.
  const [intento, setIntento] = useState(0)
  // Hora local (del navegador) en que llegó el último dato nuevo. Se mide con el mismo
  // reloj con que se compara después, así el desfase entre equipos no afecta la alerta.
  const [llegada, setLlegada] = useState(() => (antiguedadInicialMs === null ? null : Date.now() - antiguedadInicialMs))
  const [ahora, setAhora] = useState(() => Date.now())
  const ultimoRecibido = useRef(estadoInicial?.recibido_en ?? null)
  const fallosSeguidos = useRef(0)

  const aplicarEstado = useCallback((nuevo: EstadoCruce) => {
    // Solo cuenta como dato nuevo si el servidor lo recibió después del anterior.
    if (nuevo.recibido_en === ultimoRecibido.current) return
    ultimoRecibido.current = nuevo.recibido_en
    setEstado(nuevo)
    setLlegada(Date.now())
  }, [])

  // Lee el estado y los últimos eventos desde la base, con la sesión del usuario (RLS).
  const sincronizar = useCallback(async () => {
    const supabase = crearClienteNavegador()
    const [{ data: fila }, { data: ultimos }] = await Promise.all([
      supabase.from('estado_cruce').select('*').eq('cruce_id', cruceId).maybeSingle(),
      supabase.from('eventos_fase').select(COLUMNAS_EVENTO).eq('cruce_id', cruceId).order('ocurrido_en', { ascending: false }).limit(15),
    ])
    if (fila) aplicarEstado(fila as EstadoCruce)
    if (ultimos) setEventos(ultimos as EventoFase[])
  }, [cruceId, aplicarEstado])

  useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(reloj)
  }, [])

  useEffect(() => {
    const supabase = crearClienteNavegador()
    const filtro = `cruce_id=eq.${cruceId}`
    let cerrandoPorLimpieza = false
    let reintento: ReturnType<typeof setTimeout> | undefined

    // Tópico único por montaje: React vuelve a montar este efecto al navegar y en
    // desarrollo; con un nombre fijo se podría recibir el canal anterior a medio cerrar.
    const canal = supabase
      .channel(`monitoreo:${cruceId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estado_cruce', filter: filtro }, (cambio) => {
        if (cambio.eventType !== 'DELETE') aplicarEstado(cambio.new as EstadoCruce)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'eventos_fase', filter: filtro }, (cambio) => {
        const nuevo = cambio.new as EventoFase
        setEventos((previos) => [nuevo, ...previos.filter((e) => e.id !== nuevo.id)].slice(0, 15))
      })
      .subscribe((estadoCanal) => {
        if (estadoCanal === 'SUBSCRIBED') {
          fallosSeguidos.current = 0
          setConexion('conectado')
          // Lo que pasó entre la carga de la página y la suscripción no llega por el canal.
          void sincronizar()
        } else if (!cerrandoPorLimpieza && (estadoCanal === 'CHANNEL_ERROR' || estadoCanal === 'TIMED_OUT' || estadoCanal === 'CLOSED')) {
          setConexion('reconectando')
          fallosSeguidos.current += 1
          const espera = Math.min(2000 * 2 ** (fallosSeguidos.current - 1), MS_RECONEXION_MAX)
          reintento = setTimeout(() => setIntento((n) => n + 1), espera)
        }
      })

    return () => {
      cerrandoPorLimpieza = true
      clearTimeout(reintento)
      void supabase.removeChannel(canal)
    }
  }, [cruceId, intento, aplicarEstado, sincronizar])

  // Respaldo: si no llega nada nuevo por el canal, se consulta la base cada pocos segundos.
  useEffect(() => {
    const sondeo = setInterval(() => {
      if (llegada === null || Date.now() - llegada > MS_SONDEO) void sincronizar()
    }, MS_SONDEO)
    return () => clearInterval(sondeo)
  }, [llegada, sincronizar])

  // Al volver a la pestaña, el navegador pudo haber pausado el socket: se pone al día.
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') void sincronizar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [sincronizar])

  const sinDatos = llegada === null || ahora - llegada > MS_SIN_DATOS
  const segundosSinDatos = llegada === null ? null : Math.max(0, Math.round((ahora - llegada) / 1000))
  const deteccionCaida = Boolean(estado && !estado.respaldo && estado.edad_sensor > SEGUNDOS_DETECCION_CAIDA)

  return (
    <div className="grilla">
      {/* Las regiones vivas están siempre montadas y su texto no cambia cada segundo:
          así el lector de pantalla anuncia cada alerta una vez y no la repite. */}
      <div role="alert" className="alertas">
        {estado && sinDatos && (
          <p className="mensaje mensaje-alerta">
            <strong>Alerta:</strong> el cruce no está informando. Las luces mostradas pueden no ser las actuales.
          </p>
        )}
        {estado?.respaldo && (
          <p className="mensaje mensaje-alerta">
            <strong>Alerta:</strong> respaldo a tiempo fijo activo. El controlador perdió la detección y alterna por ejes.
          </p>
        )}
      </div>
      <div role="status" className="alertas">
        {deteccionCaida && (
          <p className="mensaje mensaje-aviso">
            <strong>Aviso:</strong> la detección no está entregando lecturas.
          </p>
        )}
      </div>

      <section className="tarjeta" aria-labelledby="titulo-cruce">
        <div className={estilos.encabezado}>
          <h2 id="titulo-cruce">{nombreCruce}</h2>
          <span className="chip chip-tenue" data-hueco={conexion !== 'conectado' || undefined}>
            {conexion === 'conectado' ? 'Tiempo real' : conexion === 'conectando' ? 'Conectando…' : 'Reconectando…'}
          </span>
        </div>

        {estado ? (
          <>
            <p className="solo-lector" aria-live="polite">{resumen(estado)}</p>
            <div className={estilos.cruce}>
              {ACCESOS.map((acceso, i) => {
                const color = luz(estado, acceso)
                const vehiculos = estado.detectados[i] ?? 0
                return (
                  <div key={acceso} className={`${estilos.acceso} ${estilos[`acceso${acceso}`]}`}>
                    <span className={estilos.nombreAcceso}>{NOMBRE_ACCESO[acceso]}</span>
                    {/* Sin datos frescos, el punto se dibuja hueco y se avisa en texto:
                        la luz sigue legible, pero no se presenta como confirmada. */}
                    <span className={`chip ${estilos.luz} ${estilos[color]}`} data-hueco={sinDatos || undefined}>
                      {TEXTO_LUZ[color]}
                      {sinDatos && <span className={estilos.sinConfirmar}> (sin confirmar)</span>}
                    </span>
                    <span className={`num ${estilos.vehiculos}`}>
                      {vehiculos === 0 ? 'Libre' : `${vehiculos} ${vehiculos === 1 ? 'vehículo' : 'vehículos'}`}
                    </span>
                  </div>
                )
              })}
              <dl className={estilos.centro}>
                <dt>Etapa</dt>
                <dd className={estilos.etapa}>{NOMBRE_ETAPA[estado.etapa]}</dd>
                <dt>Modo</dt>
                <dd>
                  {NOMBRE_MODO[estado.modo_activo]}
                  {estado.modo !== estado.modo_activo && <span className="tenue"> (pasando a {NOMBRE_MODO[estado.modo]})</span>}
                </dd>
                {estado.motivo_texto && (
                  <>
                    <dt>Controlador</dt>
                    <dd className="tenue">{estado.motivo_texto}</dd>
                  </>
                )}
              </dl>
            </div>
            <p className="nota separado">
              Último dato recibido a las <span className="num">{hora(estado.recibido_en)}</span>
              {segundosSinDatos !== null && segundosSinDatos > 1 && <span className="num"> · hace {duracion(segundosSinDatos)}</span>}
              {estado.edad_sensor > SEGUNDOS_DETECCION_CAIDA && (
                <span className="num"> · detección sin lecturas hace {estado.edad_sensor.toFixed(1)} s</span>
              )}
            </p>
          </>
        ) : (
          <p className="tenue">El cruce todavía no ha enviado datos. Cuando la maqueta envíe su primer latido aparecerá aquí, sin recargar.</p>
        )}
      </section>

      <section className="tarjeta" aria-labelledby="titulo-eventos">
        <h2 id="titulo-eventos">Últimos cambios de fase</h2>
        {eventos.length === 0 ? (
          <p className="tenue">Sin cambios registrados.</p>
        ) : (
          <div className="tabla-envoltura" role="region" aria-labelledby="titulo-eventos" tabIndex={0}>
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
