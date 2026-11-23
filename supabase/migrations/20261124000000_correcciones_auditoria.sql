-- Correcciones de la auditoría del 23-11-2026 (A3, A4, A6, A7, A8, A9, A10).
-- Se ejecuta completa, una sola vez, en Supabase > SQL Editor, DESPUÉS de la migración
-- inicial. Antes, correr `pnpm test:sql`, que aplica las dos migraciones en orden.
-- No modifica datos: solo funciones, políticas, permisos, restricciones e índices.
-- Va en una transacción explícita: si algo falla a mitad, no queda aplicado a medias.

begin;

-- ---------------------------------------------------------------------------
-- A3. Límite de reportes sin carrera. Dos inserts simultáneos contaban 4 cada uno y
-- pasaban los dos. El candado por autor hace que el segundo espere a que el primero
-- termine su transacción y entonces ya cuente 5.
-- ---------------------------------------------------------------------------
create or replace function privado.limitar_reportes() returns trigger
language plpgsql set search_path = ''
as $$
begin
  -- Hash de 64 bits: menos colisiones entre autores distintos (una colisión solo
  -- haría esperar de más, nunca dejaría pasar un sexto reporte).
  perform pg_advisory_xact_lock(hashtextextended(new.autor_id::text, 0));
  if (select count(*) from public.incidencias
      where autor_id = new.autor_id and creada_en > now() - interval '24 hours') >= 5 then
    raise exception 'Alcanzaste el límite de 5 reportes en 24 horas' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- A4. Tope de subidas al bucket. Sin él, una cuenta podía subir fotos de 5 MB sin
-- crear incidencias y llenar el almacenamiento. Mismo límite que los reportes: 5 en
-- 24 horas por carpeta propia.
-- El conteo no puede ir dentro de la política: una política que consulta su propia
-- tabla hace fallar a Postgres con "infinite recursion detected in policy". Va en una
-- función security definer, que no recibe parámetros: solo cuenta la carpeta de quien
-- llama, así nadie la usa para averiguar cuántas fotos subió otra cuenta.
-- Requiere que el dueño de la función (postgres) pase por alto RLS; en Supabase lo
-- hace. Comprobar tras aplicar: select rolbypassrls from pg_roles where rolname = 'postgres';
-- ---------------------------------------------------------------------------
create function privado.subidas_recientes() returns bigint
language sql stable security definer set search_path = ''
as $$
  select count(*) from storage.objects
   where bucket_id = 'incidencias'
     and (storage.foldername(name))[1] = auth.uid()::text
     and created_at > now() - interval '24 hours'
$$;
revoke all on function privado.subidas_recientes() from public;
grant execute on function privado.subidas_recientes() to authenticated;

drop policy "subir foto en carpeta propia" on storage.objects;
create policy "subir foto en carpeta propia" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'incidencias'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select privado.subidas_recientes()) < 5
  );

-- ---------------------------------------------------------------------------
-- A6. Permisos por defecto. El revoke de la migración inicial solo cubrió las tablas
-- que existían. Supabase concede a anon y authenticated todo lo que se cree después
-- en public; así, una tabla nueva nacería abierta hasta que alguien le active RLS.
-- Aplica a lo que cree el rol que ejecuta esto (postgres, el del SQL Editor).
-- El EXECUTE de PUBLIC en funciones es un permiso global de Postgres, y los permisos
-- por esquema solo se suman a los globales: no lo pueden quitar. Por eso esa línea
-- va sin "in schema" y aplica a las funciones nuevas de cualquier esquema.
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- A7. El historial solo acepta estados válidos, igual que la tabla de incidencias.
-- ---------------------------------------------------------------------------
alter table public.incidencias_historial
  add constraint incidencias_historial_estado_anterior_valido
    check (estado_anterior in ('recibida', 'en_revision', 'resuelta')),
  add constraint incidencias_historial_estado_nuevo_valido
    check (estado_nuevo in ('recibida', 'en_revision', 'resuelta'));

-- ---------------------------------------------------------------------------
-- A8. Accesos sin repetir. Zod ya rechaza {N,N} en la ingesta; la base es la segunda
-- barrera. Un CHECK no admite subconsultas, por eso la comparación va en una función.
-- Va en `public` porque la evalúa también service_role (la ingesta) y ese rol no
-- tiene uso del esquema privado; se le quita EXECUTE a anon y authenticated.
-- ---------------------------------------------------------------------------
create function public.sin_repetidos(valores text[]) returns boolean
language sql immutable set search_path = ''
as $$
  select cardinality(valores) = (select count(distinct v) from unnest(valores) as v)
$$;
revoke all on function public.sin_repetidos(text[]) from public, anon, authenticated;
grant execute on function public.sin_repetidos(text[]) to service_role;

alter table public.estado_cruce add constraint estado_cruce_activos_sin_repetir check (public.sin_repetidos(activos));
alter table public.eventos_fase add constraint eventos_fase_activos_sin_repetir check (public.sin_repetidos(activos));

-- ---------------------------------------------------------------------------
-- A9. Índices en claves foráneas que se consultan o se borran en cascada.
-- ---------------------------------------------------------------------------
create index incidencias_cruce on public.incidencias (cruce_id);
create index incidencias_historial_responsable on public.incidencias_historial (responsable_id);

-- ---------------------------------------------------------------------------
-- A10. El estado en vivo no retrocede. Si llega un latido con reportado_en anterior
-- al guardado (un reenvío viejo), la actualización se descarta y el panel no vuelve a
-- luces antiguas. Devuelve null: la fila queda intacta y no corren los triggers que
-- siguen, entre ellos marcar_recepcion (los triggers corren en orden alfabético).
-- reportado_en sale del reloj del equipo de Godot. Si ese reloj se corrige hacia atrás
-- (por ejemplo, al sincronizarse), descartar todo lo anterior dejaría el panel en "el
-- cruce no informa" hasta alcanzar la hora guardada. Por eso solo se descarta un
-- retroceso de hasta 1 minuto, que es un reenvío; uno mayor se toma como reloj corregido.
-- ---------------------------------------------------------------------------
create function privado.ignorar_latido_antiguo() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.reportado_en < old.reportado_en
     and old.reportado_en - new.reportado_en < interval '1 minute' then
    return null;
  end if;
  return new;
end
$$;
revoke all on function privado.ignorar_latido_antiguo() from public;

create trigger ignorar_latido_antiguo
  before update on public.estado_cruce
  for each row execute function privado.ignorar_latido_antiguo();

commit;
