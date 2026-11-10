'use client'

import { useActionState, useState } from 'react'
import type { EstadoIncidencia } from '@/lib/tipos'
import { cambiarEstado, type EstadoFormulario } from './acciones'

type Props = { id: string; estadoActual: EstadoIncidencia; tieneFoto: boolean }

export function FormularioEstado({ id, estadoActual, tieneFoto }: Props) {
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(cambiarEstado, {})
  // Las mismas transiciones que acepta la función SQL: recibida → en revisión o resuelta,
  // en revisión → resuelta.
  const opciones = estadoActual === 'recibida' ? (['en_revision', 'resuelta'] as const) : (['resuelta'] as const)
  const [elegido, setElegido] = useState<string>(opciones[0])

  return (
    <form action={accion}>
      {estado.error && (
        <p className="mensaje mensaje-alerta" role="alert">
          {estado.error}
        </p>
      )}
      <input type="hidden" name="id" value={id} />
      <div className="campo">
        <label htmlFor="estado">Nuevo estado</label>
        <select id="estado" name="estado" value={elegido} onChange={(e) => setElegido(e.target.value)}>
          {opciones.map((o) => (
            <option key={o} value={o}>
              {o === 'en_revision' ? 'En revisión' : 'Resuelta'}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="nota">{elegido === 'resuelta' ? 'Nota de cierre (obligatoria)' : 'Nota (opcional)'}</label>
        <textarea id="nota" name="nota" maxLength={1000} required={elegido === 'resuelta'} aria-describedby={tieneFoto && elegido === 'resuelta' ? 'aviso-foto' : undefined} />
      </div>
      {tieneFoto && elegido === 'resuelta' && (
        <p id="aviso-foto" className="tenue" style={{ fontSize: '0.85rem' }}>
          Al resolverla se elimina la foto adjunta. No se puede deshacer.
        </p>
      )}
      <button className="boton boton-principal" type="submit" disabled={enviando}>
        {enviando ? 'Guardando…' : 'Guardar cambio'}
      </button>
    </form>
  )
}
