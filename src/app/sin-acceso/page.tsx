import type { Metadata } from 'next'
import { cerrarSesion } from '@/app/acciones-sesion'

export const metadata: Metadata = { title: 'Sin acceso' }

// Aquí llega una cuenta válida sin el rol que pide la sección; por ejemplo, un ciudadano
// registrado en la app móvil que intenta entrar al panel.
export default function SinAcceso() {
  return (
    <main className="contenido" style={{ maxWidth: 520, paddingTop: '12vh' }}>
      <h1>Esta sección no está disponible para tu cuenta</h1>
      <p className="tenue">
        El panel es para el personal de operación y análisis. Si deberías tener acceso, pide al administrador que asigne
        el rol a tu cuenta.
      </p>
      <form action={cerrarSesion}>
        <button className="boton" type="submit">Cerrar sesión</button>
      </form>
    </main>
  )
}
