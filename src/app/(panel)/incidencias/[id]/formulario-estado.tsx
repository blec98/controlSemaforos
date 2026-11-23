'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import type { EstadoIncidencia } from '@/lib/tipos'
import { cambiarEstado, type EstadoFormulario } from './acciones'

type Props = { id: string; estadoActual: EstadoIncidencia; tieneFoto: boolean }

export function FormularioEstado({ id, estadoActual, tieneFoto }: Props) {
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(cambiarEstado, {})
  const mensaje = useRef<HTMLParagraphElement>(null)
  // Las mismas transiciones que acepta la función SQL: recibida → en revisión o resuelta,
  // en revisión → resuelta.
  const opciones: EstadoIncidencia[] = estadoActual === 'recibida' ? ['en_revision', 'resuelta'] : ['resuelta']
  const [elegidoGuardado, setElegido] = useState<EstadoIncidencia>(opciones[0])
  // Si el estado cambió y la opción guardada ya no existe, se usa la primera válida;
  // si no, el select mostraría una opción y la etiqueta y el aviso hablarían de otra.
  const elegido = opciones.includes(elegidoGuardado) ? elegidoGuardado : opciones[0]
  const resolviendo = elegido === 'resuelta'

  // El resultado se anuncia y recibe el foco, para que no pase inadvertido.
  useEffect(() => {
    if (estado.error || estado.listo) mensaje.current?.focus()
  }, [estado])

  return (
    <form action={accion}>
      {(estado.error || estado.listo) && (
        <p
          ref={mensaje}
          tabIndex={-1}
          id="resultado-gestion"
          role={estado.error ? 'alert' : 'status'}
          className={`mensaje ${estado.error ? 'mensaje-alerta' : 'mensaje-exito'}`}
        >
          {estado.error ?? estado.listo}
        </p>
      )}
      <input type="hidden" name="id" value={id} />
      <div className="campo">
        <label htmlFor="estado">Nuevo estado</label>
        <select id="estado" name="estado" value={elegido} onChange={(e) => setElegido(e.target.value as EstadoIncidencia)}>
          {opciones.map((o) => (
            <option key={o} value={o}>
              {o === 'en_revision' ? 'En revisión' : 'Resuelta'}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="nota">{resolviendo ? 'Nota de cierre (obligatoria)' : 'Nota (opcional)'}</label>
        <textarea
          id="nota"
          name="nota"
          maxLength={1000}
          required={resolviendo}
          defaultValue={estado.nota ?? ''}
          aria-invalid={Boolean(estado.error && estado.nota !== undefined) || undefined}
          aria-describedby={[estado.error ? 'resultado-gestion' : '', tieneFoto && resolviendo ? 'aviso-foto' : ''].filter(Boolean).join(' ') || undefined}
        />
      </div>
      {tieneFoto && resolviendo && (
        <p id="aviso-foto" className="nota">
          Al resolverla se elimina la foto adjunta. No se puede deshacer.
        </p>
      )}
      <button className="boton boton-principal" type="submit" disabled={enviando}>
        {enviando ? 'Guardando…' : 'Guardar cambio'}
      </button>
    </form>
  )
}
