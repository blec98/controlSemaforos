'use client'

import { useEffect } from 'react'

// Un fallo al leer la base se muestra como lo que es, con la opción de reintentar,
// en vez de confundirse con "no hay datos" o "no tienes acceso".
export default function ErrorPanel({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="grilla" style={{ maxWidth: 560 }}>
      <h1>No se pudieron cargar los datos</h1>
      <p className="tenue">
        La conexión con la base de datos falló. Suele ser momentáneo; si se repite, revisa el estado de Supabase.
      </p>
      <p>
        <button className="boton boton-principal" type="button" onClick={() => retry()}>
          Reintentar
        </button>
      </p>
    </div>
  )
}
