import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { z } from 'zod'
import { fechaHora, NOMBRE_ESTADO_INCIDENCIA, NOMBRE_TIPO_INCIDENCIA } from '@/lib/etiquetas'
import { exigirRol } from '@/lib/sesion'
import { crearClienteServidor } from '@/lib/supabase/servidor'
import type { CambioIncidencia, Incidencia } from '@/lib/tipos'
import { FormularioEstado } from './formulario-estado'
import estilos from '../incidencias.module.css'

export const metadata: Metadata = { title: 'Detalle de incidencia' }

export default function PaginaIncidencia({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <p>
        <Link href="/incidencias" className="tenue">← Volver a incidencias</Link>
      </p>
      <Suspense fallback={<p className="tenue">Cargando incidencia…</p>}>
        <Contenido params={params} />
      </Suspense>
    </>
  )
}

async function Contenido({ params }: { params: Promise<{ id: string }> }) {
  await exigirRol('operador')
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()

  const supabase = await crearClienteServidor()
  const [{ data: incidencia }, { data: historial }] = await Promise.all([
    supabase.from('incidencias').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('incidencias_historial')
      .select('id, estado_anterior, estado_nuevo, nota, responsable_id, cambiado_en')
      .eq('incidencia_id', id)
      .order('cambiado_en'),
  ])
  if (!incidencia) notFound()
  const datos = incidencia as Incidencia
  const cambios = (historial as CambioIncidencia[] | null) ?? []

  // Nombres del personal que aparece en el historial. RLS solo deja ver perfiles del personal.
  const responsables = [...new Set(cambios.map((c) => c.responsable_id).filter((r): r is string => Boolean(r)))]
  const { data: perfiles } = responsables.length
    ? await supabase.from('perfiles').select('id, nombre').in('id', responsables)
    : { data: [] }
  const nombre = new Map((perfiles ?? []).map((p) => [p.id as string, (p.nombre as string | null) ?? 'Operador sin nombre']))

  // URL firmada de corta duración: la foto está en un bucket privado y el enlace deja
  // de servir a los cinco minutos aunque alguien lo copie.
  const foto = datos.foto_path
    ? (await supabase.storage.from('incidencias').createSignedUrl(datos.foto_path, 300)).data?.signedUrl
    : null

  return (
    <>
      <h1>
        {NOMBRE_TIPO_INCIDENCIA[datos.tipo]} <span className={`chip ${estilos[datos.estado]}`} style={{ fontSize: '1rem', verticalAlign: 'middle' }}>{NOMBRE_ESTADO_INCIDENCIA[datos.estado]}</span>
      </h1>

      <div className={estilos.detalle}>
        <section className="tarjeta" aria-labelledby="titulo-reporte">
          <h2 id="titulo-reporte">Reporte</h2>
          <dl className={estilos.datos}>
            <dt>Recibida</dt>
            <dd className="num">{fechaHora(datos.creada_en)}</dd>
            <dt>Descripción</dt>
            <dd>{datos.descripcion}</dd>
          </dl>
          {foto ? (
            // <img> y no next/image: el optimizador de Next descargaría la foto y la guardaría
            // en su caché del servidor, una copia de un dato personal que no se debe retener.
            // eslint-disable-next-line @next/next/no-img-element
            <img className={estilos.foto} src={foto} alt="Foto adjunta por quien reportó la incidencia" />
          ) : datos.foto_path ? (
            <p className="tenue" style={{ marginTop: '1rem' }}>La foto adjunta no está disponible.</p>
          ) : null}
        </section>

        <div className="grilla">
          {datos.estado !== 'resuelta' && (
            <section className="tarjeta" aria-labelledby="titulo-gestion">
              <h2 id="titulo-gestion">Gestionar</h2>
              <FormularioEstado id={datos.id} estadoActual={datos.estado} tieneFoto={Boolean(datos.foto_path)} />
            </section>
          )}

          <section className="tarjeta" aria-labelledby="titulo-historial">
            <h2 id="titulo-historial">Historial</h2>
            {cambios.length === 0 ? (
              <p className="tenue" style={{ margin: 0 }}>Sin cambios desde que se recibió.</p>
            ) : (
              <ol className={estilos.historial}>
                {cambios.map((c) => (
                  <li key={c.id}>
                    <strong>{NOMBRE_ESTADO_INCIDENCIA[c.estado_anterior]} → {NOMBRE_ESTADO_INCIDENCIA[c.estado_nuevo]}</strong>
                    <p className="tenue">
                      {fechaHora(c.cambiado_en)} · {c.responsable_id ? nombre.get(c.responsable_id) ?? 'Operador' : 'Cuenta eliminada'}
                    </p>
                    {c.nota && <p>{c.nota}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
