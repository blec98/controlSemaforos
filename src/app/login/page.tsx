import type { Metadata } from 'next'
import { FormularioLogin } from './formulario-login'

export const metadata: Metadata = { title: 'Ingresar' }

export default function PaginaLogin() {
  return (
    <main className="contenido" style={{ maxWidth: 380, paddingTop: '12vh' }}>
      <h1>Control de tránsito</h1>
      <p className="tenue">Panel del operador y del analista. Las cuentas del personal las crea el administrador del proyecto.</p>
      <div className="tarjeta" style={{ marginTop: '1.5rem' }}>
        <FormularioLogin />
      </div>
    </main>
  )
}
