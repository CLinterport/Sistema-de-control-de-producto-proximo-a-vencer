import { NextResponse } from 'next/server';
import { sql, registrarBitacora } from '@/lib/db';
import { usuarioActual } from '@/lib/sesion';

// Cada rol ve una bandeja distinta. La cadena es:
// mercaderista captura -> supervisor jr propone -> supervisor revisa
// (autoriza hasta el limite, o traslada) -> KAM autoriza -> mercaderista ejecuta
const BANDEJA = {
  supervisor_jr: 'sin_propuesta',
  supervisor: 'revision_supervisor',
  kam: 'revision_kam',
  mercaderista: 'por_ejecutar',
  gerencia: 'todos',
  administrador: 'todos',
};

export async function GET(req) {
  const u = await usuarioActual();
  if (!u) return NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 });

  const bandeja = new URL(req.url).searchParams.get('bandeja') ?? BANDEJA[u.rol] ?? 'todos';
  const verTodo = u.rol === 'administrador' || u.rol === 'gerencia';

  // Cada quien ve lo de sus tiendas. Un supervisor no debe ver los casos de otro.
  const filas = await sql`
    with base as (
      select c.id as caso_id, c.estado as estado_caso, c.abierto_en, c.cantidad_inicial,
             d.id as deteccion_id, d.descripcion, d.cantidad, d.fecha_vencimiento,
             d.dias_restantes, d.estado, d.cajas, d.unidades_por_caja,
             d.pdv_nombre, d.punto_venta_id, d.supervisor_id, d.kam_id,
             a.id as accion_id, a.estado::text as estado_accion, a.cantidad_unidades,
             a.cantidad_cajas, a.nivel_requerido::text as nivel_requerido,
             ta.nombre as tipo_accion, ta.es_perdida,
             prop.nombre as propuesta_por, a.propuesta_en,
             aut.nombre as autorizada_por
      from sentinel.caso c
      join sentinel.v_deteccion d on d.id = c.deteccion_id
      left join lateral (
        select * from sentinel.accion x
        where x.caso_id = c.id and x.estado <> 'rechazada'
        order by x.propuesta_en desc limit 1) a on true
      left join sentinel.tipo_accion ta on ta.id = a.tipo_accion_id
      left join sentinel.usuario prop on prop.id = a.propuesta_por
      left join sentinel.usuario aut on aut.id = a.autorizada_por
      where c.estado <> 'cerrado'
        and (${verTodo} or d.supervisor_id = ${u.id} or d.kam_id = ${u.id}
             or ${u.rol} in ('mercaderista','supervisor_jr'))
    )
    select * from base
    where case ${bandeja}
            when 'sin_propuesta'        then accion_id is null
            when 'revision_supervisor'  then estado_accion = 'en_revision_supervisor'
            when 'revision_kam'         then estado_accion = 'en_revision_kam'
            when 'por_ejecutar'         then estado_accion = 'autorizada'
            else true
          end
    order by dias_restantes asc, cantidad desc
    limit 100`;

  const [conteos] = await sql`
    select
      count(*) filter (where a.id is null)                                 as sin_propuesta,
      count(*) filter (where a.estado = 'en_revision_supervisor')          as revision_supervisor,
      count(*) filter (where a.estado = 'en_revision_kam')                 as revision_kam,
      count(*) filter (where a.estado = 'autorizada')                      as por_ejecutar
    from sentinel.caso c
    join sentinel.v_deteccion d on d.id = c.deteccion_id
    left join lateral (
      select * from sentinel.accion x where x.caso_id = c.id and x.estado <> 'rechazada'
      order by x.propuesta_en desc limit 1) a on true
    where c.estado <> 'cerrado'
      and (${verTodo} or d.supervisor_id = ${u.id} or d.kam_id = ${u.id}
           or ${u.rol} in ('mercaderista','supervisor_jr'))`;

  const acciones = await sql`
    select id, nombre, es_perdida from sentinel.tipo_accion
    where activo order by orden`;
  const causas = await sql`
    select id, nombre from sentinel.causa where activo order by orden`;
  const [lim] = await sql`
    select limite_cajas from sentinel.configuracion_autorizacion
    where nivel = 'supervisor' order by vigente_desde desc limit 1`;

  return NextResponse.json({
    filas, conteos, acciones, causas,
    limiteCajas: Number(lim?.limite_cajas ?? 0),
    rol: u.rol, bandeja,
  });
}

// El supervisor junior propone. No aprueba nada.
export async function POST(req) {
  const u = await usuarioActual();
  if (!u) return NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 });
  if (!['supervisor_jr', 'supervisor', 'administrador'].includes(u.rol))
    return NextResponse.json({ error: 'Tu rol no propone acciones.' }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const casoId = Number(b.casoId), tipoId = Number(b.tipoAccionId), un = Number(b.unidades);
  if (!casoId || !tipoId) return NextResponse.json({ error: 'Falta el caso o la acción.' }, { status: 400 });
  if (!Number.isInteger(un) || un < 1)
    return NextResponse.json({ error: 'La cantidad debe ser mayor a cero.' }, { status: 400 });

  try {
    const resultado = await sql.begin(async tx => {
      const [c] = await tx`
        select c.id, c.cantidad_inicial, d.producto_id
        from sentinel.caso c join sentinel.deteccion d on d.id = c.deteccion_id
        where c.id = ${casoId} and c.estado <> 'cerrado'`;
      if (!c) return { error: 'Ese caso ya no está abierto.' };
      if (un > c.cantidad_inicial)
        return { error: `No puedes afectar más de las ${c.cantidad_inicial} unidades detectadas.` };

      const [{ nivel_requerido: nivel }] = await tx`
        select sentinel.nivel_requerido(${c.producto_id}, ${un}) as nivel_requerido`;
      const [{ calcular_cajas: cajas }] = await tx`
        select sentinel.calcular_cajas(${c.producto_id}, ${un}) as calcular_cajas`;

      const [a] = await tx`
        insert into sentinel.accion
          (caso_id, tipo_accion_id, cantidad_unidades, cantidad_cajas, nivel_requerido,
           propuesta_por, estado)
        values (${casoId}, ${tipoId}, ${un}, ${cajas}, ${nivel}::sentinel.nivel_autorizacion,
                ${u.id}, 'en_revision_supervisor')
        returning id`;
      await tx`update sentinel.caso set estado = 'con_propuesta' where id = ${casoId}`;
      return { id: a.id, nivel, cajas };
    });

    if (resultado.error) return NextResponse.json(resultado, { status: 400 });
    await registrarBitacora({ usuarioId: u.id, entidad: 'accion', entidadId: resultado.id,
      accion: 'propuesta', despues: { casoId, unidades: un, nivel: resultado.nivel } });
    return NextResponse.json(resultado);
  } catch (e) {
    console.error('proponer', e);
    return NextResponse.json({ error: 'No se pudo registrar la propuesta.' }, { status: 500 });
  }
}

export async function PATCH(req) {
  const u = await usuarioActual();
  if (!u) return NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const id = Number(b.accionId);
  if (!id) return NextResponse.json({ error: 'Falta la acción.' }, { status: 400 });

  const [a] = await sql`
    select a.*, c.id as caso_id, c.cantidad_inicial, ta.es_perdida
    from sentinel.accion a
    join sentinel.caso c on c.id = a.caso_id
    join sentinel.tipo_accion ta on ta.id = a.tipo_accion_id
    where a.id = ${id}`;
  if (!a) return NextResponse.json({ error: 'Esa acción no existe.' }, { status: 404 });

  try {
    // Autorizar. La regla del limite vive aqui, no en la pantalla: esconder un
    // boton no impide que alguien llame directo a la interfaz.
    if (b.accion === 'autorizar') {
      const permitido =
        (u.rol === 'supervisor' && a.estado === 'en_revision_supervisor' && a.nivel_requerido === 'supervisor') ||
        (u.rol === 'kam' && a.estado === 'en_revision_kam') ||
        u.rol === 'administrador';
      if (!permitido)
        return NextResponse.json(
          { error: a.nivel_requerido === 'kam' && u.rol === 'supervisor'
              ? `Son ${a.cantidad_cajas ?? 'varias'} cajas y supera tu límite. Trasládalo al KAM.`
              : 'No te corresponde autorizar esta acción.' }, { status: 403 });

      await sql`
        update sentinel.accion
           set estado = 'autorizada', autorizada_por = ${u.id}, autorizada_en = now(),
               revisada_por = coalesce(revisada_por, ${u.id}),
               revisada_en = coalesce(revisada_en, now())
         where id = ${id}`;
      await sql`update sentinel.caso set estado = 'con_accion_autorizada' where id = ${a.caso_id}`;
      await registrarBitacora({ usuarioId: u.id, entidad: 'accion', entidadId: id, accion: 'autorizada' });
      return NextResponse.json({ ok: true });
    }

    if (b.accion === 'escalar') {
      if (u.rol !== 'supervisor' && u.rol !== 'administrador')
        return NextResponse.json({ error: 'Solo el supervisor traslada al KAM.' }, { status: 403 });
      await sql`
        update sentinel.accion
           set estado = 'en_revision_kam', revisada_por = ${u.id}, revisada_en = now()
         where id = ${id}`;
      await registrarBitacora({ usuarioId: u.id, entidad: 'accion', entidadId: id,
        accion: 'trasladada al KAM' });
      return NextResponse.json({ ok: true });
    }

    if (b.accion === 'rechazar') {
      const motivo = String(b.motivo ?? '').trim();
      if (!motivo) return NextResponse.json({ error: 'Escribe el motivo del rechazo.' }, { status: 400 });
      await sql`
        update sentinel.accion set estado = 'rechazada', motivo_rechazo = ${motivo}
         where id = ${id}`;
      // El caso vuelve al supervisor junior para que proponga otra cosa
      await sql`update sentinel.caso set estado = 'abierto' where id = ${a.caso_id}`;
      await registrarBitacora({ usuarioId: u.id, entidad: 'accion', entidadId: id,
        accion: 'rechazada', despues: { motivo } });
      return NextResponse.json({ ok: true });
    }

    // Ejecutar cierra el caso y registra el resultado real
    if (b.accion === 'ejecutar') {
      if (a.estado !== 'autorizada')
        return NextResponse.json({ error: 'Esa acción todavía no está autorizada.' }, { status: 400 });
      const movidas = Number(b.movidas);
      const causaId = Number(b.causaId);
      if (!Number.isInteger(movidas) || movidas < 0)
        return NextResponse.json({ error: 'Escribe cuántas unidades se movieron.' }, { status: 400 });
      if (movidas > a.cantidad_unidades)
        return NextResponse.json({ error: `No pueden ser más de las ${a.cantidad_unidades} autorizadas.` }, { status: 400 });
      if (!causaId)
        return NextResponse.json({ error: 'Sin causa no se puede cerrar el caso.' }, { status: 400 });

      await sql.begin(async tx => {
        await tx`
          update sentinel.accion
             set estado = 'ejecutada', ejecutada_por = ${u.id}, ejecutada_en = now(),
                 numero_vale = ${b.numeroVale || null}, cantidad_resultante = ${movidas}
           where id = ${id}`;
        // Las acciones marcadas como pérdida no suman al indicador de recuperación
        const resuelta = a.es_perdida ? 0 : movidas;
        const perdida = a.es_perdida ? movidas : (a.cantidad_unidades - movidas);
        await tx`
          update sentinel.caso
             set cantidad_resuelta = ${resuelta}, cantidad_perdida = ${perdida},
                 estado = 'cerrado', cerrado_en = now(), cerrado_por = ${u.id},
                 causa_id = ${causaId}, nota_cierre = ${b.nota || null}
           where id = ${a.caso_id}`;
      });
      await registrarBitacora({ usuarioId: u.id, entidad: 'accion', entidadId: id,
        accion: 'ejecutada', despues: { movidas, vale: b.numeroVale ?? null } });
      return NextResponse.json({ ok: true, perdida: a.es_perdida });
    }

    return NextResponse.json({ error: 'Acción no reconocida.' }, { status: 400 });
  } catch (e) {
    console.error('casos', e);
    const m = String(e.message ?? '');
    if (m.includes('cantidades_cuadran'))
      return NextResponse.json({ error: 'Las cantidades no cuadran con lo detectado.' }, { status: 400 });
    return NextResponse.json({ error: 'No se pudo completar la operación.' }, { status: 500 });
  }
}
