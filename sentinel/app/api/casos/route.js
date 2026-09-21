import { NextResponse } from 'next/server';
import { sql, registrarBitacora } from '@/lib/db';
import { usuarioActual } from '@/lib/sesion';

// Cadena: mercaderista captura -> supervisor jr propone -> supervisor revisa
// (autoriza hasta el limite, o traslada) -> KAM autoriza -> mercaderista ejecuta
const BANDEJA = {
  supervisor_jr: 'sin_propuesta',
  supervisor: 'revision_supervisor',
  kam: 'revision_kam',
  mercaderista: 'por_ejecutar',
  gerencia: 'todos',
  administrador: 'todos',
};

// El costo y el valor en riesgo son dato de supervisor para arriba. La
// restriccion vive aqui: si se dejara en la pantalla, bastaria abrir el
// endpoint para ver el costo de cada linea.
const VE_DINERO = ['supervisor', 'kam', 'gerencia', 'administrador'];

// Quien puede clasificar una tienda desde un caso. Es una correccion de dato
// maestro hecha por quien tiene el caso enfrente, no una pantalla de catalogos.
const CLASIFICA = ['supervisor', 'kam', 'administrador'];

async function regionesDe(usuarioId) {
  const z = await sql`
    select valor_ambito from sentinel.usuario_zona
    where usuario_id = ${usuarioId} and tipo_ambito = 'region'`;
  return z.map(r => r.valor_ambito);
}

// Un caso pertenece a quien atiende esa tienda. Antes del cambio de rol los 7
// supervisores filtraban por supervisor_id; al pasar a supervisor_jr caian en
// un comodin que les mostraba los casos de las 2,798 tiendas. Ahora filtran por
// region. Las tiendas sin region todavia se ven, porque hoy son 2,791 y el
// catalogo se cura solo conforme Captura pregunta la zona en el primer uso.
function alcance(u, regiones) {
  const verTodo = u.rol === 'administrador' || u.rol === 'gerencia';
  return sql`(
    ${verTodo}
    or (${u.rol} = 'kam'           and d.kam_id = ${u.id})
    or (${u.rol} = 'supervisor'    and (d.supervisor_id = ${u.id}
                                        or d.region = any(${regiones})
                                        or d.region is null))
    or (${u.rol} = 'supervisor_jr' and (d.region = any(${regiones})
                                        or d.region is null))
    or (${u.rol} = 'mercaderista'  and (d.capturado_por = ${u.id}
                                        or d.region = any(${regiones})
                                        or d.region is null))
  )`;
}

export async function GET(req) {
  const u = await usuarioActual();
  if (!u) return NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 });

  const bandeja = new URL(req.url).searchParams.get('bandeja') ?? BANDEJA[u.rol] ?? 'todos';
  const veDinero = VE_DINERO.includes(u.rol);
  const regiones = await regionesDe(u.id);
  const mio = alcance(u, regiones);

  const filas = await sql`
    with base as (
      select c.id as caso_id, c.estado as estado_caso, c.abierto_en, c.cantidad_inicial,
             d.id as deteccion_id, d.descripcion, d.cantidad, d.fecha_vencimiento,
             d.dias_restantes, d.estado, d.cajas, d.unidades_por_caja,
             d.fecha_precision, d.foto_evidencia_url, d.medida,
             d.producto_id, d.codigo_sap, d.upc_pendiente, d.unidad_sugerida,
             d.pdv_nombre, d.punto_venta_id, d.cadena_grupo, d.region,
             d.supervisor_id, d.kam_id, d.supervisor_nombre, d.kam_nombre,
             d.por_clasificar,
             case when ${veDinero} then d.valor_en_riesgo end as valor_en_riesgo,
             s.sugerido as upc_sugerido, s.coincidencias as upc_coincidencias,
             s.muestra as upc_muestra, s.envase as upc_envase, s.tamano as upc_tamano,
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
      -- La sugerencia viaja con su respaldo y solo para quien la necesita.
      -- Se muestra como texto; nunca se aplica sola.
      left join lateral (
        select * from sentinel.sugerir_upc(d.producto_id)
        where d.upc_pendiente and d.producto_id is not null) s on true
      where c.estado <> 'cerrado' and ${mio}
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
      count(*) filter (where a.id is null)                        as sin_propuesta,
      count(*) filter (where a.estado = 'en_revision_supervisor') as revision_supervisor,
      count(*) filter (where a.estado = 'en_revision_kam')        as revision_kam,
      count(*) filter (where a.estado = 'autorizada')             as por_ejecutar
    from sentinel.caso c
    join sentinel.v_deteccion d on d.id = c.deteccion_id
    left join lateral (
      select * from sentinel.accion x where x.caso_id = c.id and x.estado <> 'rechazada'
      order by x.propuesta_en desc limit 1) a on true
    where c.estado <> 'cerrado' and ${mio}`;

  const acciones = await sql`
    select id, nombre, es_perdida from sentinel.tipo_accion where activo order by orden`;
  const causas = await sql`
    select id, nombre from sentinel.causa where activo order by orden`;
  const [lim] = await sql`
    select limite_cajas from sentinel.configuracion_autorizacion
    where nivel = 'supervisor' order by vigente_desde desc limit 1`;

  // Valores reales del catalogo, no una lista escrita a mano en la pantalla
  const cadenas = await sql`
    select distinct cadena_grupo from sentinel.punto_venta
    where cadena_grupo is not null order by 1`;
  const regionesCat = await sql`
    select distinct valor_ambito as region from sentinel.usuario_zona
    where tipo_ambito = 'region' order by 1`;

  return NextResponse.json({
    filas, conteos, acciones, causas,
    limiteCajas: Number(lim?.limite_cajas ?? 0),
    cadenas: cadenas.map(c => c.cadena_grupo),
    regiones: regionesCat.map(r => r.region),
    veDinero, rol: u.rol, bandeja,
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
  const upc = b.unidadesPorCaja == null || b.unidadesPorCaja === '' ? null : Number(b.unidadesPorCaja);
  if (!casoId || !tipoId)
    return NextResponse.json({ error: 'Falta el caso o la acción.' }, { status: 400 });
  if (!Number.isInteger(un) || un < 1)
    return NextResponse.json({ error: 'La cantidad debe ser mayor a cero.' }, { status: 400 });
  if (upc !== null && (!Number.isInteger(upc) || upc < 1 || upc > 999))
    return NextResponse.json({ error: 'Las unidades por caja deben ir entre 1 y 999.' }, { status: 400 });

  try {
    const resultado = await sql.begin(async tx => {
      const [c] = await tx`
        select c.id, c.cantidad_inicial, d.producto_id, p.unidades_por_caja
        from sentinel.caso c
        join sentinel.deteccion d on d.id = c.deteccion_id
        left join sentinel.producto p on p.id = d.producto_id
        where c.id = ${casoId} and c.estado <> 'cerrado'`;
      if (!c) return { error: 'Ese caso ya no está abierto.' };
      if (un > c.cantidad_inicial)
        return { error: `No puedes afectar más de las ${c.cantidad_inicial} unidades detectadas.` };

      // Unidades por caja: se pregunta una sola vez, con la sugerencia a la
      // vista. Se confirma antes de calcular el nivel, porque de ese dato
      // depende si la accion la firma el supervisor o escala al KAM.
      let upcFijado = null;
      if (upc !== null && c.producto_id && c.unidades_por_caja == null) {
        await tx`
          update sentinel.producto
             set unidades_por_caja = ${upc}, upc_fuente = 'supervisor',
                 upc_confirmado_por = ${u.id}, upc_confirmado_en = now()
           where id = ${c.producto_id} and unidades_por_caja is null`;
        upcFijado = upc;
      }

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
      return { id: a.id, nivel, cajas, productoId: c.producto_id, upcFijado };
    });

    if (resultado.error) return NextResponse.json(resultado, { status: 400 });
    if (resultado.upcFijado)
      await registrarBitacora({ usuarioId: u.id, entidad: 'producto',
        entidadId: resultado.productoId, accion: 'unidades por caja confirmadas',
        despues: { unidades_por_caja: resultado.upcFijado, fuente: 'supervisor' } });
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

  // Clasificar la tienda del caso. Un caso en tienda sin cadena no tiene KAM a
  // quien viajar; en vez de estacionarlo con un humano de respaldo, se corrige
  // el dato aqui mismo y el trigger de punto_venta deriva KAM y supervisor.
  if (b.accion === 'clasificar') {
    if (!CLASIFICA.includes(u.rol))
      return NextResponse.json({ error: 'Tu rol no clasifica tiendas.' }, { status: 403 });
    const pdvId = Number(b.puntoVentaId);
    const cadena = String(b.cadenaGrupo ?? '').trim() || null;
    const region = String(b.region ?? '').trim() || null;
    if (!pdvId) return NextResponse.json({ error: 'Falta la tienda.' }, { status: 400 });
    if (!cadena && !region)
      return NextResponse.json({ error: 'Elige al menos la cadena o la región.' }, { status: 400 });

    const [antes] = await sql`
      select cadena_grupo, region from sentinel.punto_venta where id = ${pdvId}`;
    if (!antes) return NextResponse.json({ error: 'Esa tienda no existe.' }, { status: 404 });

    const [pv] = await sql`
      update sentinel.punto_venta
         set cadena_grupo = coalesce(${cadena}, cadena_grupo),
             region       = coalesce(${region}, region)
       where id = ${pdvId}
       returning cadena_grupo, region, kam_id, supervisor_id`;
    await registrarBitacora({ usuarioId: u.id, entidad: 'punto_venta', entidadId: pdvId,
      accion: 'clasificada desde caso', antes, despues: pv });

    const [k] = pv.kam_id
      ? await sql`select nombre from sentinel.usuario where id = ${pv.kam_id}`
      : [null];
    return NextResponse.json({ ok: true, kamNombre: k?.nombre ?? null,
      sinKam: !pv.kam_id });
  }

  const id = Number(b.accionId);
  if (!id) return NextResponse.json({ error: 'Falta la acción.' }, { status: 400 });

  const [a] = await sql`
    select a.*, c.id as caso_id, c.cantidad_inicial, ta.es_perdida,
           d.foto_evidencia_url, d.capturado_en, d.punto_venta_id,
           pv.kam_id, pv.cadena_grupo, k.nombre as kam_nombre
    from sentinel.accion a
    join sentinel.caso c on c.id = a.caso_id
    join sentinel.tipo_accion ta on ta.id = a.tipo_accion_id
    join sentinel.deteccion d on d.id = c.deteccion_id
    join sentinel.punto_venta pv on pv.id = d.punto_venta_id
    left join sentinel.usuario k on k.id = pv.kam_id
    where a.id = ${id}`;
  if (!a) return NextResponse.json({ error: 'Esa acción no existe.' }, { status: 404 });

  try {
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

      // La evidencia la pide quien firma, no quien anota. La fecha de corte
      // evita que la regla bloquee lo capturado antes de que existiera la
      // camara: sin ella, hoy quedarian 9 de 9 casos imposibles de autorizar.
      const [cfg] = await sql`
        select
          max(valor) filter (where clave = 'foto_obligatoria_autorizar') as exige,
          max(valor) filter (where clave = 'foto_obligatoria_desde')     as desde
        from sentinel.configuracion_sistema`;
      const exigeFoto = cfg?.exige === 'true'
        && cfg?.desde && new Date(a.capturado_en) >= new Date(cfg.desde);
      if (exigeFoto && !a.foto_evidencia_url)
        return NextResponse.json(
          { error: 'Falta la foto del código de fecha. Pídesela a quien capturó antes de autorizar.' },
          { status: 400 });

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
      if (!a.kam_id)
        return NextResponse.json({
          error: 'Esta tienda no tiene cadena asignada, así que el sistema no sabe a qué KAM pasarla. Clasifícala primero.',
          requiereClasificar: true, puntoVentaId: a.punto_venta_id,
        }, { status: 409 });

      await sql`
        update sentinel.accion
           set estado = 'en_revision_kam', revisada_por = ${u.id}, revisada_en = now()
         where id = ${id}`;
      await registrarBitacora({ usuarioId: u.id, entidad: 'accion', entidadId: id,
        accion: 'trasladada al KAM', despues: { kam: a.kam_nombre } });
      return NextResponse.json({ ok: true, kamNombre: a.kam_nombre });
    }

    if (b.accion === 'rechazar') {
      const motivo = String(b.motivo ?? '').trim();
      if (!motivo) return NextResponse.json({ error: 'Escribe el motivo del rechazo.' }, { status: 400 });
      await sql`
        update sentinel.accion set estado = 'rechazada', motivo_rechazo = ${motivo}
         where id = ${id}`;
      await sql`update sentinel.caso set estado = 'abierto' where id = ${a.caso_id}`;
      await registrarBitacora({ usuarioId: u.id, entidad: 'accion', entidadId: id,
        accion: 'rechazada', despues: { motivo } });
      return NextResponse.json({ ok: true });
    }

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
