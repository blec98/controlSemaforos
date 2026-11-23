# Contrato de la app móvil (Flutter)

La app es el panel web en el teléfono, más el reporte de fallas. **Se conecta directo a Supabase** con el paquete oficial `supabase_flutter`, como define el informe (3.4.4). No hay una API REST propia que replique la base: la protección está en las políticas RLS, que dependen del rol de la cuenta y no del cliente, así que la app ve exactamente lo mismo que la web para cada rol.

La única ruta de la web que usa la app es `DELETE /api/cuenta`, para eliminar la cuenta propia (RF8), porque necesita la llave secreta.

## Conexión

```dart
await Supabase.initialize(
  url: 'https://rhtoneixthvfejonusan.supabase.co',
  publishableKey: '<llave publicable, sb_publishable_...>',
);
final supabase = Supabase.instance.client;
```

- **Solo la llave publicable** viaja en la app. La secreta (`sb_secret_...`) nunca va en la app ni en su repositorio: se salta todas las políticas. Si alguna vez se expone, se revoca.
- `anonKey` está obsoleto en `supabase_flutter`; se usa `publishableKey`.
- Conviene pasar URL y llave con `--dart-define` y no escribirlas en el código.

## Cuentas y roles

- Registro con correo y contraseña (`signUp`). **Confirm email está activo**: la cuenta no inicia sesión hasta confirmar el correo.
- Toda cuenta nueva es `ciudadano`. Los roles `operador` y `analista` los asigna Bernardo a mano; ninguna operación de la app puede cambiar un rol.
- Después de iniciar sesión, leer el rol para decidir qué pantallas mostrar:

```dart
final perfil = await supabase.from('perfiles').select('rol, nombre').eq('id', supabase.auth.currentUser!.id).single();
```

| Pantalla | ciudadano | analista | operador |
|---|---|---|---|
| Luces en vivo (`estado_cruce`) | Sí | Sí | Sí |
| Cambios de fase (`eventos_fase`) | No | Sí | Sí |
| Estadísticas (`estadisticas_trafico`) | No (recibe ceros) | Sí | Sí |
| Reportar una falla | Sí | Sí | Sí |
| Mis incidencias y su historial | Sí | Sí | Sí |
| Todas las incidencias y gestionarlas | No | No | Sí |

Que el ciudadano no vea estadísticas es decisión de la web, y la app la respeta. Si se quiere cambiar, es una migración, no un cambio en la app.

## Datos del cruce

El PMV tiene un cruce: `cruce_id = 'maqueta-01'`. Los códigos son los del controlador de Godot; la app muestra siempre una etiqueta:

| Campo | Códigos | Etiqueta |
|---|---|---|
| Acceso | `N`, `E`, `S`, `W` | Norte, Oriente, Sur, Poniente |
| Modo | `fti`, `adaptive`, `fixed` | FTI por demanda, Adaptativo, Tiempo fijo |
| Etapa | `GREEN`, `YELLOW`, `ALL_RED` | Verde, Amarillo, Todo rojo |
| Motivo del corte | `sin_demanda`, `verde_maximo`, `tiempo_fijo`, `balance_colas`, `prioridad`, `cambio_modo` | Sin demanda, Verde máximo, Tiempo fijo, Balance de colas, Prioridad, Cambio de modo |
| Tipo de vehículo | `auto`, `camioneta`, `bus` | Auto, Camioneta, Bus |

Toda hora se muestra en `America/Santiago`, sin importar la zona del teléfono.

### Estado en vivo

`estado_cruce` tiene una fila por cruce: `modo`, `modo_activo`, `etapa`, `activos` (accesos con luz), `detectados` (vehículos por acceso, en orden N, E, S, W), `edad_sensor` (segundos sin lecturas), `respaldo`, `motivo_texto`, `reportado_en` y `recibido_en`.

La luz de un acceso es la de la etapa si el acceso está en `activos`; si no, es rojo. Es la misma regla de `FTITrafficController.light()`.

```dart
final canal = supabase
    .channel('monitoreo:maqueta-01:${DateTime.now().microsecondsSinceEpoch}')
    .onPostgresChanges(
      event: PostgresChangeEvent.all,
      schema: 'public',
      table: 'estado_cruce',
      filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'cruce_id', value: 'maqueta-01'),
      callback: (payload) => actualizar(payload.newRecord),
    )
    .subscribe();
```

Lo que aprendimos en la web y conviene repetir:

- **Leer el estado una vez al suscribirse**, porque lo ocurrido antes de la suscripción no llega por el canal.
- **Respaldo:** si pasan más de 3 s sin un dato nuevo, consultar `estado_cruce` directo cada 3 s. Así la app sigue leyendo aunque el canal se corte o quede en silencio.
- **Reconectar solo** si el canal se cae, con una espera creciente de 2 a 30 s, y ponerse al día al volver la app al primer plano.
- **Alertas:** sin dato nuevo en más de 3 s, avisar que "el cruce no está informando". Con `respaldo = true`, avisar "respaldo a tiempo fijo activo". Con `edad_sensor > 2`, avisar que la detección no entrega lecturas.
- **Nombre del canal único:** con un nombre fijo se puede recibir un canal anterior a medio cerrar.

`eventos_fase` (solo personal) recibe una fila por cambio de etapa (`ocurrido_en`, `etapa`, `activos`, `modo_activo`, `respaldo` y `motivo`, este último solo al pasar a amarillo) y también está en tiempo real.

### Estadísticas (solo personal)

```dart
final datos = await supabase.rpc('estadisticas_trafico', params: {
  'p_cruce': 'maqueta-01',
  'p_desde': '2026-11-17', // fecha local, AAAA-MM-DD
  'p_hasta': '2026-11-23',
  'p_acceso': null,         // o 'N', 'E', 'S', 'W'
});
```

Devuelve un solo JSON: `unidad` (`hour` si el rango es de hasta 2 días, si no `day`), `total`, `por_acceso`, `por_tipo`, `serie` (períodos con conteo por tipo), `perfil_horario` (horas 0 a 23 por tipo) y `cortes` (cantidad por motivo). El rango máximo es de 93 días. `serie` solo trae los períodos con datos: la web completa los demás con ceros para que los huecos se vean, y la app debería hacer lo mismo.

## Incidencias

### Reportar (cualquier cuenta)

1. **Foto opcional.** Se sube primero a `incidencias/<uid>/<nombre>`, en JPEG, PNG o WebP y hasta 5 MB.
2. **Incidencia.** Se inserta solo con estas columnas; `estado`, `autor_id` y las fechas las pone la base, y enviarlas da error de permisos.

```dart
final uid = supabase.auth.currentUser!.id;
String? fotoPath;
if (foto != null) {
  fotoPath = '$uid/${DateTime.now().millisecondsSinceEpoch}.jpg';
  await supabase.storage.from('incidencias').upload(fotoPath, foto,
      fileOptions: const FileOptions(contentType: 'image/jpeg'));
}
final incidencia = await supabase.from('incidencias').insert({
  'cruce_id': 'maqueta-01',
  'tipo': 'luz_apagada', // luz_apagada, intermitente, tiempo_anomalo, dano_fisico, otro
  'descripcion': texto,  // entre 5 y 1000 caracteres
  'foto_path': fotoPath,
}).select().single();
```

Si el insert falla después de subir la foto, hay que borrar esa foto para no dejarla huérfana.

**Límites:** 5 reportes y 5 fotos por cuenta en 24 horas. La app no pide ubicación (RNF7).

### Seguir las propias

`incidencias` y `incidencias_historial` devuelven a cada ciudadano solo lo suyo. `incidencias` está en tiempo real, así que la app puede escuchar los cambios de estado (HU4) con un filtro por `autor_id`. Los estados son `recibida`, `en_revision` y `resuelta`, con las etiquetas Recibida, En revisión y Resuelta.

### Gestionar (solo operador)

El estado cambia **solo** con la función `cambiar_estado_incidencia`, que escribe el historial en la misma transacción. Las transiciones válidas son `recibida` → `en_revision` o `resuelta`, y `en_revision` → `resuelta`. Para resolver hace falta una nota.

**El orden importa al resolver una incidencia con foto: primero se borra la foto y después se cambia el estado.** Si el borrado falla, no se cierra la incidencia; así nunca queda una resuelta con una foto que nadie va a borrar.

```dart
final actual = await supabase.from('incidencias').select('estado, foto_path').eq('id', id).single();
if (estadoNuevo == 'resuelta' && actual['foto_path'] != null) {
  await supabase.storage.from('incidencias').remove([actual['foto_path']]);
}
await supabase.rpc('cambiar_estado_incidencia', params: {
  'p_incidencia': id,
  'p_estado': estadoNuevo, // en_revision o resuelta
  'p_nota': nota,          // obligatoria para resuelta
});
```

- **Foto de una incidencia:** se muestra con una URL firmada de 5 minutos, `createSignedUrl(path, 300)`. Si se vence, se pide otra.
- **Historial:** el nombre de quien hizo cada cambio sale de `perfiles(nombre)` filtrando por `responsable_id`.

## Eliminar la cuenta (RF8)

```
DELETE https://control-semaforos.vercel.app/api/cuenta
Authorization: Bearer <access token de la sesión>
```

```dart
final sesion = await supabase.auth.getSession(); // entrega un token vigente
final r = await http.delete(Uri.parse('https://control-semaforos.vercel.app/api/cuenta'),
    headers: {'Authorization': 'Bearer ${sesion!.accessToken}'});
```

La web borra primero las fotos de `incidencias/<uid>/` y después la cuenta. La base elimina en cascada el perfil, las incidencias y su historial (HU6, criterios 1 y 2). Después hay que cerrar la sesión en la app.

| Respuesta | Significado |
|---|---|
| 200 `{"eliminada": true}` | Listo |
| 401 | Sin token, o sesión vencida o inválida: volver a iniciar sesión |
| 502 | No se pudieron borrar las fotos (la cuenta sigue) o la cuenta (las fotos ya se borraron): reintentar |

Antes de crear la cuenta, la app muestra el aviso de privacidad con la finalidad de cada dato (HU6, criterio 3).

## Errores de la base

`PostgrestException.code` trae el código de Postgres:

| Código | Cuándo | Qué mostrar |
|---|---|---|
| `P0001` | Sexto reporte en 24 horas | "Alcanzaste el límite de 5 reportes en 24 horas" |
| `42501` | Operación que el rol no permite, o columna no permitida al insertar | No debería verse si la app respeta los roles |
| `22023` | Transición inválida, falta la nota de cierre o rango de fechas inválido | El mensaje que trae, que ya está en español |
| `P0002` | La incidencia no existe | Recargar la lista |
| `23514` | Un dato no cumple una restricción (por ejemplo, descripción vacía) | Revisar el formulario |

Una subida rechazada por el tope de fotos o por estar fuera de la carpeta propia llega como error de Storage (403).
