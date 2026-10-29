'use client'

import { useActionState } from 'react'
import { iniciarSesion, type EstadoLogin } from '@/app/acciones-sesion'

export function FormularioLogin() {
  const [estado, accion, enviando] = useActionState<EstadoLogin, FormData>(iniciarSesion, {})

  return (
    <form action={accion}>
      {estado.error && (
        <p className="mensaje mensaje-alerta" role="alert">
          {estado.error}
        </p>
      )}
      <div className="campo">
        <label htmlFor="email">Correo</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="campo">
        <label htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="boton boton-principal" type="submit" disabled={enviando}>
        {enviando ? 'Ingresando…' : 'Ingresar'}
      </button>
    </form>
  )
}
