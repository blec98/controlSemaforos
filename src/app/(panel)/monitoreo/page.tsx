import type { Metadata } from 'next'
import { Suspense } from 'react'
import { CRUCE_ID } from '@/lib/config'
import { exigirRol } from '@/lib/sesion'
import { crearClienteServidor } from '@/lib/supabase/servidor'
import type { EstadoCruce, EventoFase } from '@/lib/tipos'
import { PanelEnVivo } from './panel-en-vivo'

export const metadata: Metadata = { title: 'Monitoreo' }

export default function PaginaMonitoreo() {
  return (
    <>
      <h1>Monitoreo en vivo</h1>
      <Suspense fallback={<p className="tenue">Cargando el estado del cruce…</p>}>
        <Contenido />
      </Suspense>
    </>
  )
}

async function Contenido() {
  await exigirRol('operador', 'analista')
  const { estado, antiguedadMs, eventos, nombreCruce } = await cargarMonitoreo()

  return (
    <PanelEnVivo
      cruceId={CRUCE_ID}
      nombreCruce={nombreCruce}
      estadoInicial={estado}
      antiguedadInicialMs={antiguedadMs}
      eventosIniciales={eventos}
    />
  )
}

async function cargarMonitoreo() {
  const supabase = await crearClienteServidor()

  const [{ data: estado }, { data: eventos }, { data: cruce }] = await Promise.all([
    supabase.from('estado_cruce').select('*').eq('cruce_id', CRUCE_ID).maybeSingle(),
    supabase
      .from('eventos_fase')
      .select('id, ocurrido_en, etapa, activos, modo_activo, respaldo, motivo')
      .eq('cruce_id', CRUCE_ID)
      .order('ocurrido_en', { ascending: false })
      .limit(15),
    supabase.from('cruces').select('nombre').eq('id', CRUCE_ID).maybeSingle(),
  ])

  // La antigüedad se calcula aquí, con el reloj del servidor, y no en el navegador:
  // el reloj del equipo del operador puede estar desfasado varios segundos.
  const antiguedadMs = estado ? Math.max(0, Date.now() - Date.parse(estado.recibido_en)) : null

  return {
    estado: (estado as EstadoCruce | null) ?? null,
    antiguedadMs,
    eventos: (eventos as EventoFase[] | null) ?? [],
    nombreCruce: (cruce?.nombre as string | undefined) ?? CRUCE_ID,
  }
}
