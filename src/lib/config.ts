// El PMV tiene un solo cruce. Debe coincidir con el id sembrado en la migración.
export const CRUCE_ID = 'maqueta-01'

// Godot envía un latido por segundo. Pasado este margen sin datos, el panel avisa
// que el cruce dejó de informar (RNF3 pide reflejar cambios en menos de 2 s).
export const MS_SIN_DATOS = 3000

// HU2, criterio 3: más de 2 s sin lecturas de detección se muestra como alerta.
export const SEGUNDOS_DETECCION_CAIDA = 2

export function variable(nombre: string): string {
  const valor = process.env[nombre]
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}. Revisa .env.local (plantilla en .env.example).`)
  return valor
}
