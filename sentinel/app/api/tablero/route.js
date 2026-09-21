import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { usuarioActual } from '@/lib/sesion';

// El tablero es la pantalla que se lleva a la reunion. Se limita a gerencia y
// administrador: los demas roles tienen su bandeja, que es donde actuan.
const VE_TABLERO = new Set(['gerencia', 'administrador']);

export async function GET() {
  const u = await usuarioActual();
  if (!u) return NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 });
  if (!VE_TABLERO.has(u.rol))
    return NextResponse.json({ error: 'Este tablero es de gerencia.' }, { status: 403 });

  // EL indicador. La vista v_indicador_principal divide resueltas entre
  // detectadas sin mirar si el producto seguia vivo al detectarlo, y ese matiz
  // es justamente el argumento del proyecto: recuperar algo ya vencido no
  // cuenta. Aqui se calcula explicito comparando la fecha de vencimiento
  // contra el dia en que se abrio el caso.
  const [ind] = await sql`
    select
      coalesce(sum(c.cantidad_inicial), 0)::int                                   as detectadas,
      coalesce(sum(c.cantidad_inicial) filter (
        where d.fecha_vencimiento > c.abierto_en::date), 0)::int                  as detectadas_vivas,
      coalesce(sum(c.cantidad_resuelta) filter (
        where d.fecha_vencimiento > c.abierto_en::date), 0)::int                  as resueltas_vivas,
      coalesce(sum(c.cantidad_perdida), 0)::int                                   as perdidas,
      count(*)::int                                                               as casos,
      count(*) filter (where c.estado = 'cerrado')::int                           as cerrados
    from sentinel.caso c
    join sentinel.deteccion d on d.id = c.deteccion_id`;

  const meses = await sql`
    select to_char(date_trunc('month', c.abierto_en), 'YYYY-MM') as mes,
           sum(c.cantidad_inicial)::int as detectadas,
           coalesce(sum(c.cantidad_resuelta) filter (
             where d.fecha_vencimiento > c.abierto_en::date), 0)::int as resueltas_vivas
    from sentinel.caso c
    join sentinel.deteccion d on d.id = c.deteccion_id
    group by 1 order by 1 desc limit 6`;

  // Que hacemos hoy. Cada fila es una cola con dueno y con edad: lo que no se
  // mueve es lo que se vence.
  const [hoy] = await sql`
    with a as (
      select c.id as caso_id, c.estado as estado_caso, c.abierto_en,
             d.dias_restantes, d.cantidad,
             x.id as accion_id, x.estado::text as estado_accion, x.propuesta_en, x.revisada_en
      from sentinel.caso c
      join sentinel.v_deteccion d on d.id = c.deteccion_id
      left join lateral (
        select * from sentinel.accion y
        where y.caso_id = c.id and y.estado <> 'rechazada'
        order by y.propuesta_en desc limit 1) x on true
      where c.estado <> 'cerrado'
    )
    select
      count(*) filter (where accion_id is null)::int                              as sin_propuesta,
      coalesce(sum(cantidad) filter (where accion_id is null), 0)::int            as un_sin_propuesta,
      max(current_date - abierto_en::date) filter (where accion_id is null)::int  as espera_sin_propuesta,
      count(*) filter (where estado_accion in ('en_revision_supervisor','en_revision_kam'))::int
                                                                                  as esperando_firma,
      max(current_date - propuesta_en::date) filter (
        where estado_accion in ('en_revision_supervisor','en_revision_kam'))::int as espera_firma,
      count(*) filter (where estado_accion = 'autorizada')::int                   as por_ejecutar,
      count(*) filter (where dias_restantes <= 7 and dias_restantes > 0)::int     as criticos,
      coalesce(sum(cantidad) filter (where dias_restantes <= 7 and dias_restantes > 0), 0)::int as un_criticos,
      count(*) filter (where dias_restantes <= 0)::int                            as vencidos,
      coalesce(sum(cantidad) filter (where dias_restantes <= 0), 0)::int          as un_vencidos
    from a`;

  const cadena = await sql`select * from sentinel.v_consolidado_cadena order by unidades desc nulls last`;
  const supervisor = await sql`select * from sentinel.v_consolidado_supervisor order by unidades desc nulls last`;

  // Lo mas urgente, con nombre y apellido. Un tablero sin esta lista obliga a
  // abrir otra pantalla para saber que hacer.
  const urgentes = await sql`
    select c.id as caso_id, d.descripcion, d.pdv_nombre, d.cadena_grupo, d.cantidad,
           d.dias_restantes, d.estado, d.supervisor_nombre, d.kam_nombre,
           x.estado::text as estado_accion
    from sentinel.caso c
    join sentinel.v_deteccion d on d.id = c.deteccion_id
    left join lateral (
      select * from sentinel.accion y where y.caso_id = c.id and y.estado <> 'rechazada'
      order by y.propuesta_en desc limit 1) x on true
    where c.estado <> 'cerrado'
    order by d.dias_restantes asc, d.cantidad desc
    limit 12`;

  // Cobertura. v_cobertura se apoya en la tabla visita, que nadie escribe:
  // devuelve nulo para las 2,798 tiendas. Mientras eso no se corrija, la
  // cobertura real sale de las capturas, y solo sobre tiendas ya visitadas.
  const cobertura = await sql`
    select pv.nombre, pv.cadena_grupo, pv.region,
           max(d.capturado_en) as ultima,
           (current_date - max(d.capturado_en)::date)::int as dias_sin_captura
    from sentinel.deteccion d
    join sentinel.punto_venta pv on pv.id = d.punto_venta_id
    group by pv.id, pv.nombre, pv.cadena_grupo, pv.region
    having (current_date - max(d.capturado_en)::date) >= 4
    order by 5 desc limit 15`;

  const [ciclo] = await sql`
    select round(avg(dias_ciclo_total), 1) as dias_ciclo,
           round(avg(dias_deteccion_a_propuesta), 1) as a_propuesta,
           round(avg(dias_propuesta_a_autorizacion), 1) as a_autorizacion,
           round(avg(dias_autorizacion_a_ejecucion), 1) as a_ejecucion,
           count(*)::int as acciones
    from sentinel.v_tiempos_ciclo`;

  const [causas] = await sql`
    select coalesce(json_agg(t order by t.veces desc), '[]'::json) as lista
    from (
      select ca.nombre, count(*)::int as veces, sum(c.cantidad_perdida)::int as unidades
      from sentinel.caso c join sentinel.causa ca on ca.id = c.causa_id
      where c.estado = 'cerrado'
      group by ca.nombre limit 8) t`;

  // El dinero. costo_unitario sigue vacio, asi que en vez de mostrar Q 0 y que
  // alguien lo lea como "no hay riesgo", se informa que el dato no existe.
  const [dinero] = await sql`
    select count(*) filter (where costo_unitario is not null)::int as con_costo,
           count(*)::int as productos
    from sentinel.producto`;

  return NextResponse.json({
    indicador: ind, meses, hoy, cadena, supervisor, urgentes, cobertura, ciclo,
    causas: causas.lista, dinero,
    generado: new Date().toISOString(),
  });
}
