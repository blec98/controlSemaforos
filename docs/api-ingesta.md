# Contrato de ingesta: Godot → web

Godot envía los datos del cruce a una sola ruta de la web, que valida el lote y lo guarda en Supabase. Godot nunca habla con Supabase ni recibe órdenes de vuelta: la respuesta solo dice si el lote se guardó.

```
POST https://<dominio-de-la-web>/api/ingesta
Authorization: Bearer <INGESTA_TOKEN>
Content-Type: application/json
```

El token lo entrega quien administra la web. No se sube al repositorio de Godot: se lee de una variable de entorno o de un archivo ignorado por git.

## Cuerpo

Los tres bloques son opcionales, pero el lote no puede venir vacío. Todas las fechas van en ISO 8601 **con zona horaria y milisegundos**, por ejemplo `2026-10-29T21:15:03.250Z`, y usan el reloj del sistema, no el tiempo de la simulación.

```json
{
  "cruce_id": "maqueta-01",
  "estado": {
    "reportado_en": "2026-10-29T21:15:03.250Z",
    "mode": "adaptive",
    "running_mode": "adaptive",
    "stage": "GREEN",
    "active": ["N", "S"],
    "counts": [2, 0, 1, 0],
    "sensor_age": 0.1,
    "fallback": false,
    "reason": "Balance de colas y espera"
  },
  "eventos": [
    { "ocurrido_en": "2026-10-29T21:15:01.000Z", "stage": "YELLOW", "active": ["E", "W"], "running_mode": "adaptive", "fallback": false, "motivo": "sin_demanda" }
  ],
  "conteos": [
    { "minuto": "2026-10-29T21:14:00.000Z", "acceso": "N", "tipo": "auto", "cantidad": 7 }
  ]
}
```

### `estado`: el latido

Son los campos de `FTITrafficController.snapshot()` con los mismos nombres, más `reportado_en`. Se envía **una vez por segundo y además en cada cambio de etapa**; el panel avisa que el cruce no informa si pasan más de 3 s sin latido.

| Campo | Valores |
|---|---|
| `mode`, `running_mode` | `fti`, `adaptive`, `fixed` |
| `stage` | `GREEN`, `YELLOW`, `ALL_RED` |
| `active` | accesos activos, sin repetir: `N`, `E`, `S`, `W` |
| `counts` | cuatro números en orden N, E, S, W (se redondean a enteros) |
| `sensor_age` | segundos desde la última lectura de detección |
| `fallback` | `true` mientras opera el respaldo fijo |
| `reason` | texto libre, máximo 120 caracteres; se muestra tal cual en el panel |

### `eventos`: cambios de etapa (RF3)

Un evento por cada vez que cambia `stage`. `motivo` va **solo en el paso a `YELLOW`**, que es cuando se corta un verde; en `GREEN` y `ALL_RED` va `null` u omitido. Según la lógica actual de `traffic_controller.gd`:

| Situación en el controlador | `motivo` |
|---|---|
| Adaptativo: el verde llegó a `green_duration()` (16 s) | `verde_maximo` |
| Adaptativo: `current == 0` y hay demanda en otro eje tras 4 s | `sin_demanda` |
| Adaptativo: `other > current + 1` tras 6,5 s | `balance_colas` |
| Adaptativo: prioridad V2I hacia el otro eje | `prioridad` |
| Fijo, respaldo o FTI: terminó el turno de duración fija | `tiempo_fijo` |
| `requested != running_mode` con la etapa en verde | `cambio_modo` |

Hoy el controlador escribe `"Fin de turno: amarillo"` en los cuatro casos del modo adaptativo, así que para informar el motivo hay que distinguirlos donde se calcula `end_turn`.

La combinación `cruce_id` + `ocurrido_en` identifica al evento. Por eso los milisegundos son obligatorios: a velocidad ×4 dos cambios pueden caer en el mismo segundo y el segundo se descartaría como duplicado.

### `conteos`: vehículos por minuto (RF1)

Vehículos que **cruzaron la línea de detención** de cada acceso durante el minuto, por tipo. `minuto` es el inicio del minuto, con segundos y milisegundos en cero. `tipo` es `auto`, `camioneta` o `bus`; mientras los vehículos del modelo no tengan tipo, se envía todo como `auto`. Reenviar el mismo minuto reemplaza el valor anterior.

## Respuestas

| Código | Significado | Qué hace Godot |
|---|---|---|
| 200 | Lote guardado | Saca el lote de la cola local |
| 400 | Lote inválido; `detalle` dice qué campo falló | No reintentar: es un error del envío. Registrar y descartar |
| 401 | Token ausente o incorrecto | No reintentar; revisar la configuración |
| 403 | El `cruce_id` no corresponde al token | No reintentar |
| 413 | Más de 512 KB | Partir el lote |
| 502 | La web no pudo guardar en Supabase | Conservar en la cola y reintentar |
| error de red | Sin conexión | Conservar en la cola y reintentar |

Límites por lote: 2000 eventos y 2000 conteos. Se aceptan fechas de hasta 7 días atrás, lo que cubre el reenvío de la cola tras una desconexión (RNF5), y hasta 60 s en el futuro por desfase de reloj.

## Probar sin Godot

```bash
curl -X POST http://localhost:3000/api/ingesta -H "Authorization: Bearer $INGESTA_TOKEN" -H "Content-Type: application/json" -d "{\"cruce_id\":\"maqueta-01\",\"estado\":{\"reportado_en\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"mode\":\"fti\",\"running_mode\":\"fti\",\"stage\":\"GREEN\",\"active\":[\"N\"],\"counts\":[1,0,0,0],\"sensor_age\":0.1,\"fallback\":false}}"
```
