-- Semáforo inteligente: esquema inicial (H2 del backlog).
-- Ejecutar completo, una sola vez, en Supabase > SQL Editor sobre un proyecto vacío.
--
-- Regla que ordena este archivo: nadie escribe datos del cruce desde la API pública.
-- Conteos, eventos y estado los inserta solo la ruta /api/ingesta de la web, con la
-- llave secreta en el servidor. Las incidencias las crea la app y su estado lo cambia
-- solo la función cambiar_estado_incidencia, que deja el historial en la misma transacción.

-- ---------------------------------------------------------------------------
-- Esquema privado para funciones auxiliares. No está expuesto por la API REST,
-- así que nadie puede llamarlas directamente; solo las usan las políticas.
-- ---------------------------------------------------------------------------
create schema privado;
revoke all on schema privado from public;
grant usage on schema privado to authenticated;

-- ---------------------------------------------------------------------------
-- Catálogo del cruce
-- ---------------------------------------------------------------------------
create table public.cruces (
  id     text primary key check (id ~ '^[a-z0-9-]{3,40}$'),
  nombre text not null check (char_length(nombre) between 1 and 120)
);

-- Los códigos N, E, S, W son los mismos que usa traffic_controller.gd (C1..C4).
create table public.accesos (
  cruce_id text not null references public.cruces (id) on delete cascade,
  codigo   text not null check (codigo in ('N', 'E', 'S', 'W')),
  nombre   text not null check (char_length(nombre) between 1 and 80),
  eje      text generated always as (case when codigo in ('N', 'S') then 'NS' else 'EW' end) stored,
  primary key (cruce_id, codigo)
);

-- ---------------------------------------------------------------------------
-- Perfiles y roles
-- ---------------------------------------------------------------------------
-- Se guarda solo el rol y, para el personal, un nombre visible en el historial.
-- El correo ya vive en auth.users; duplicarlo aquí sería un dato personal más que proteger.
create table public.perfiles (
  id        uuid primary key references auth.users (id) on delete cascade,
  rol       text not null default 'ciudadano' check (rol in ('ciudadano', 'operador', 'analista')),
  nombre    text check (char_length(nombre) <= 80),
  creado_en timestamptz not null default now()
);

-- security definer porque la consulta a perfiles desde una política de perfiles
-- entraría en recursión. search_path vacío para que nadie pueda suplantar tablas.
create function privado.rol_actual() returns text
language sql stable security definer set search_path = ''
as $$
  select rol from public.perfiles where id = auth.uid()
$$;

create function privado.es_operador() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(privado.rol_actual() = 'operador', false)
$$;

create function privado.es_personal() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(privado.rol_actual() in ('operador', 'analista'), false)
$$;

revoke all on function privado.rol_actual(), privado.es_operador(), privado.es_personal() from public;
grant execute on function privado.rol_actual(), privado.es_operador(), privado.es_personal() to authenticated;

-- Toda cuenta nueva nace como ciudadano. El rol de operador o analista se asigna a mano
-- desde el SQL Editor (ver docs/puesta-en-marcha.md); ninguna API permite cambiarlo.
create function privado.crear_perfil() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.perfiles (id) values (new.id);
  return new;
end
$$;
revoke all on function privado.crear_perfil() from public;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function privado.crear_perfil();

-- ---------------------------------------------------------------------------
-- Datos del cruce (los escribe solo /api/ingesta)
-- ---------------------------------------------------------------------------
-- Los valores de modo y etapa son los códigos de traffic_controller.gd tal cual,
-- para que Godot no tenga que traducir nada: fti, adaptive, fixed y GREEN, YELLOW, ALL_RED.

-- Una fila por cruce, sobrescrita en cada latido. Es lo que lee el monitoreo en vivo.
create table public.estado_cruce (
  cruce_id     text primary key references public.cruces (id) on delete cascade,
  modo         text not null check (modo in ('fti', 'adaptive', 'fixed')),
  modo_activo  text not null check (modo_activo in ('fti', 'adaptive', 'fixed')),
  etapa        text not null check (etapa in ('GREEN', 'YELLOW', 'ALL_RED')),
  activos      text[] not null default '{}' check (activos <@ array['N', 'E', 'S', 'W']),
  detectados   smallint[] not null check (cardinality(detectados) = 4),
  edad_sensor  real not null check (edad_sensor >= 0),
  respaldo     boolean not null,
  motivo_texto text check (char_length(motivo_texto) <= 120),
  reportado_en timestamptz not null,
  -- Lo pone el servidor: es la hora en que confiar para saber si el cruce dejó de informar.
  recibido_en  timestamptz not null default now()
);

-- El upsert de cada latido actualiza la fila; este trigger renueva recibido_en en cada
-- escritura sin depender del reloj de quien envía.
create function privado.marcar_recepcion() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.recibido_en := now();
  return new;
end
$$;
revoke all on function privado.marcar_recepcion() from public;

create trigger marcar_recepcion
  before insert or update on public.estado_cruce
  for each row execute function privado.marcar_recepcion();

-- Un evento por cada cambio de etapa. El motivo solo existe cuando se corta un verde,
-- es decir, en el paso a YELLOW (RF3).
create table public.eventos_fase (
  id          bigint generated always as identity primary key,
  cruce_id    text not null references public.cruces (id) on delete cascade,
  ocurrido_en timestamptz not null,
  etapa       text not null check (etapa in ('GREEN', 'YELLOW', 'ALL_RED')),
  activos     text[] not null default '{}' check (activos <@ array['N', 'E', 'S', 'W']),
  modo_activo text not null check (modo_activo in ('fti', 'adaptive', 'fixed')),
  respaldo    boolean not null default false,
  motivo      text check (motivo in ('sin_demanda', 'verde_maximo', 'tiempo_fijo', 'balance_colas', 'prioridad', 'cambio_modo')),
  recibido_en timestamptz not null default now(),
  check (motivo is null or etapa = 'YELLOW'),
  -- Evita duplicados cuando Godot reenvía su cola local tras una desconexión (RNF5).
  unique (cruce_id, ocurrido_en)
);

create table public.conteos_minuto (
  cruce_id    text not null,
  acceso      text not null,
  minuto      timestamptz not null check (minuto = date_trunc('minute', minuto)),
  tipo        text not null check (tipo in ('auto', 'camioneta', 'bus')),
  cantidad    integer not null check (cantidad between 0 and 1000),
  recibido_en timestamptz not null default now(),
  primary key (cruce_id, acceso, minuto, tipo),
  foreign key (cruce_id, acceso) references public.accesos (cruce_id, codigo) on delete cascade
);
-- Las estadísticas filtran por cruce y rango de fechas sobre todos los accesos.
create index conteos_minuto_cruce_minuto on public.conteos_minuto (cruce_id, minuto);

-- ---------------------------------------------------------------------------
-- Incidencias
-- ---------------------------------------------------------------------------
create table public.incidencias (
  id             uuid primary key default gen_random_uuid(),
  cruce_id       text not null references public.cruces (id),
  -- on delete cascade: al eliminar la cuenta se borran sus incidencias (RF8).
  autor_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo           text not null check (tipo in ('luz_apagada', 'intermitente', 'tiempo_anomalo', 'dano_fisico', 'otro')),
  descripcion    text not null check (char_length(btrim(descripcion)) between 5 and 1000),
  -- Ruta dentro del bucket privado: <uuid del autor>/<archivo>.
  foto_path      text check (foto_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  estado         text not null default 'recibida' check (estado in ('recibida', 'en_revision', 'resuelta')),
  creada_en      timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);
create index incidencias_estado_fecha on public.incidencias (estado, creada_en desc);
create index incidencias_autor on public.incidencias (autor_id, creada_en desc);

create table public.incidencias_historial (
  id              bigint generated always as identity primary key,
  incidencia_id   uuid not null references public.incidencias (id) on delete cascade,
  estado_anterior text not null,
  estado_nuevo    text not null,
  nota            text check (char_length(nota) <= 1000),
  -- set null: si se elimina la cuenta de un operador, el historial se conserva sin su identidad.
  responsable_id  uuid references auth.users (id) on delete set null,
  cambiado_en     timestamptz not null default now()
);
create index incidencias_historial_incidencia on public.incidencias_historial (incidencia_id, cambiado_en);

-- Límite de reportes por cuenta (M7). Corre con los permisos de quien inserta, y como la
-- política de lectura solo le muestra sus propias incidencias, cuenta exactamente esas.
create function privado.limitar_reportes() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (select count(*) from public.incidencias
      where autor_id = new.autor_id and creada_en > now() - interval '24 hours') >= 5 then
    raise exception 'Alcanzaste el límite de 5 reportes en 24 horas' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function privado.limitar_reportes() from public;

create trigger limitar_reportes
  before insert on public.incidencias
  for each row execute function privado.limitar_reportes();

-- Único camino para cambiar el estado de una incidencia (RF7). Al ser una función,
-- el cambio y su fila de historial se escriben juntos o no se escribe ninguno.
create function public.cambiar_estado_incidencia(p_incidencia uuid, p_estado text, p_nota text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_actual text;
begin
  if not privado.es_operador() then
    raise exception 'Solo un operador puede cambiar el estado de una incidencia' using errcode = '42501';
  end if;

  select estado into v_actual from public.incidencias where id = p_incidencia for update;
  if not found then
    raise exception 'La incidencia no existe' using errcode = 'P0002';
  end if;

  -- resuelta es final: reabrir no está en el alcance y dejaría la foto ya borrada sin respaldo.
  if not ((v_actual = 'recibida' and p_estado in ('en_revision', 'resuelta'))
          or (v_actual = 'en_revision' and p_estado = 'resuelta')) then
    raise exception 'Transición no permitida: % a %', v_actual, p_estado using errcode = '22023';
  end if;

  if p_estado = 'resuelta' and coalesce(btrim(p_nota), '') = '' then
    raise exception 'Para resolver una incidencia hace falta una nota de cierre' using errcode = '22023';
  end if;

  insert into public.incidencias_historial (incidencia_id, estado_anterior, estado_nuevo, nota, responsable_id)
  values (p_incidencia, v_actual, p_estado, nullif(btrim(p_nota), ''), auth.uid());

  -- La foto se borra del bucket desde la web antes de llamar a esta función;
  -- aquí solo se suelta la referencia (M3).
  update public.incidencias
     set estado = p_estado,
         actualizada_en = now(),
         foto_path = case when p_estado = 'resuelta' then null else foto_path end
   where id = p_incidencia;
end
$$;

-- ---------------------------------------------------------------------------
-- Estadísticas (RF5). security invoker: corre con las políticas de quien consulta,
-- así que un ciudadano recibe ceros y no puede saltarse RLS por esta vía.
-- Devuelve un solo jsonb para no chocar con el límite de filas de la API REST.
-- ---------------------------------------------------------------------------
create function public.estadisticas_trafico(p_cruce text, p_desde date, p_hasta date, p_acceso text default null)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_inicio timestamptz := p_desde::timestamp at time zone 'America/Santiago';
  v_fin    timestamptz := (p_hasta + 1)::timestamp at time zone 'America/Santiago';
  -- Hasta dos días se agrupa por hora; más allá, por día, para que el gráfico se pueda leer.
  v_unidad text := case when p_hasta - p_desde <= 1 then 'hour' else 'day' end;
  v_resultado jsonb;
begin
  if p_hasta < p_desde then
    raise exception 'La fecha final es anterior a la inicial' using errcode = '22023';
  end if;
  if p_hasta - p_desde > 92 then
    raise exception 'El rango máximo es de 93 días' using errcode = '22023';
  end if;

  with c as (
    select acceso, tipo, cantidad, minuto at time zone 'America/Santiago' as local
      from public.conteos_minuto
     where cruce_id = p_cruce
       and minuto >= v_inicio and minuto < v_fin
       and (p_acceso is null or acceso = p_acceso)
  ),
  serie as (
    select to_char(date_trunc(v_unidad, local), 'YYYY-MM-DD"T"HH24:MI') as periodo,
           sum(cantidad) filter (where tipo = 'auto')      as auto,
           sum(cantidad) filter (where tipo = 'camioneta') as camioneta,
           sum(cantidad) filter (where tipo = 'bus')       as bus
      from c group by 1
  ),
  perfil as (
    select extract(hour from local)::int as hora,
           sum(cantidad) filter (where tipo = 'auto')      as auto,
           sum(cantidad) filter (where tipo = 'camioneta') as camioneta,
           sum(cantidad) filter (where tipo = 'bus')       as bus
      from c group by 1
  ),
  -- Los cambios de fase son del cruce completo: no se filtran por acceso.
  cortes as (
    select motivo, count(*) as n
      from public.eventos_fase
     where cruce_id = p_cruce and etapa = 'YELLOW'
       and ocurrido_en >= v_inicio and ocurrido_en < v_fin
     group by motivo
  )
  select jsonb_build_object(
    'unidad', v_unidad,
    'total', (select coalesce(sum(cantidad), 0) from c),
    'por_acceso', (select coalesce(jsonb_object_agg(acceso, n), '{}') from (select acceso, sum(cantidad) as n from c group by acceso) x),
    'por_tipo', (select coalesce(jsonb_object_agg(tipo, n), '{}') from (select tipo, sum(cantidad) as n from c group by tipo) x),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('periodo', periodo, 'auto', coalesce(auto, 0), 'camioneta', coalesce(camioneta, 0), 'bus', coalesce(bus, 0)) order by periodo), '[]') from serie),
    'perfil_horario', (select coalesce(jsonb_agg(jsonb_build_object('hora', hora, 'auto', coalesce(auto, 0), 'camioneta', coalesce(camioneta, 0), 'bus', coalesce(bus, 0)) order by hora), '[]') from perfil),
    'cortes', (select coalesce(jsonb_object_agg(coalesce(motivo, 'sin_motivo'), n), '{}') from cortes)
  ) into v_resultado;

  return v_resultado;
end
$$;

-- Supabase concede EXECUTE en funciones nuevas de public a anon; se retira de forma explícita.
revoke all on function public.cambiar_estado_incidencia(uuid, text, text) from public, anon;
revoke all on function public.estadisticas_trafico(text, date, date, text) from public, anon;
grant execute on function public.cambiar_estado_incidencia(uuid, text, text) to authenticated;
grant execute on function public.estadisticas_trafico(text, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Permisos por tabla. RLS decide qué filas; los GRANT deciden qué operaciones.
-- Se cierran los dos para que una política mal escrita a futuro no abra escritura sola.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.cruces, public.accesos, public.perfiles, public.estado_cruce,
                public.eventos_fase, public.conteos_minuto, public.incidencias,
                public.incidencias_historial to authenticated;

-- La app solo puede escribir estas columnas al reportar. estado, autor_id y fechas
-- toman su valor por defecto y no se pueden fijar desde el cliente.
grant insert (cruce_id, tipo, descripcion, foto_path) on public.incidencias to authenticated;

alter table public.cruces                enable row level security;
alter table public.accesos               enable row level security;
alter table public.perfiles              enable row level security;
alter table public.estado_cruce          enable row level security;
alter table public.eventos_fase          enable row level security;
alter table public.conteos_minuto        enable row level security;
alter table public.incidencias           enable row level security;
alter table public.incidencias_historial enable row level security;

create policy "catalogo visible" on public.cruces
  for select to authenticated using (true);
create policy "catalogo visible" on public.accesos
  for select to authenticated using (true);

-- Cada cuenta ve su perfil; el personal ve además los perfiles del personal,
-- para mostrar quién hizo cada cambio. Nadie ve perfiles de ciudadanos ajenos.
create policy "perfil propio o del personal" on public.perfiles
  for select to authenticated
  using (id = (select auth.uid()) or ((select privado.es_personal()) and rol <> 'ciudadano'));

-- El estado de las luces lo leen la web y la app (solo lectura).
create policy "estado visible" on public.estado_cruce
  for select to authenticated using (true);

create policy "eventos para el personal" on public.eventos_fase
  for select to authenticated using ((select privado.es_personal()));
create policy "conteos para el personal" on public.conteos_minuto
  for select to authenticated using ((select privado.es_personal()));

create policy "incidencias propias o del operador" on public.incidencias
  for select to authenticated
  using (autor_id = (select auth.uid()) or (select privado.es_operador()));

create policy "reportar a nombre propio" on public.incidencias
  for insert to authenticated
  with check (
    autor_id = (select auth.uid())
    and (foto_path is null or split_part(foto_path, '/', 1) = (select auth.uid())::text)
  );

create policy "historial de lo propio o del operador" on public.incidencias_historial
  for select to authenticated
  using (
    (select privado.es_operador())
    or exists (select 1 from public.incidencias i
               where i.id = incidencia_id and i.autor_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Fotos de incidencias: bucket privado, 5 MB, solo imágenes.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incidencias', 'incidencias', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

create policy "subir foto en carpeta propia" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'incidencias' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "ver foto propia o como operador" on storage.objects
  for select to authenticated
  using (bucket_id = 'incidencias'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or (select privado.es_operador())));

create policy "borrar foto propia o como operador" on storage.objects
  for delete to authenticated
  using (bucket_id = 'incidencias'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or (select privado.es_operador())));

-- ---------------------------------------------------------------------------
-- Tiempo real: el monitoreo escucha estado y eventos; la app, el estado de sus incidencias.
-- Realtime aplica las mismas políticas RLS a cada suscriptor.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.estado_cruce, public.eventos_fase, public.incidencias;

-- ---------------------------------------------------------------------------
-- Datos base del PMV: un cruce de dos calles con cuatro accesos.
-- ---------------------------------------------------------------------------
insert into public.cruces (id, nombre) values ('maqueta-01', 'Cruce de la maqueta 3D');
insert into public.accesos (cruce_id, codigo, nombre) values
  ('maqueta-01', 'N', 'Acceso norte'),
  ('maqueta-01', 'E', 'Acceso oriente'),
  ('maqueta-01', 'S', 'Acceso sur'),
  ('maqueta-01', 'W', 'Acceso poniente');
