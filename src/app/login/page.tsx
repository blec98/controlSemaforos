import type { Metadata } from 'next'
import { FormularioLogin } from './formulario-login'

export const metadata: Metadata = { title: 'Ingresar' }

export default function PaginaLogin() {
  return (
    <main className="contenido pagina-estrecha">
      <h1>Control de tránsito</h1>
      <p className="tenue">Panel del operador y del analista. Las cuentas del personal las crea el administrador del proyecto.</p>
      <FormularioLogin />
    </main>
  )
}
