import { NextResponse } from 'next/server';
import { sql, registrarBitacora } from '@/lib/db';
import { usuarioActual } from '@/lib/sesion';

const ROLES = ['mercaderista', 'supervisor_jr', 'supervisor', 'kam', 'gerencia', 'administrador'];

// Solo el administrador entra aqui. Se valida en el servidor, no en la pantalla:
// ocultar un boton no es un control de acceso.
async function exigirAdmin() {
  const u = await usuarioActual();
  if (!u) return { error: NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 }) };
  if (u.rol !== 'administrador')
    return { error: NextResponse.json({ error: 'Solo el administrador entra a maestros.' }, { status: 403 }) };
  return { u };
}

// Excel abre CSV con doble clic si lleva BOM y separador de coma. Se prefiere a
// una libreria de xlsx: una dependencia mas es una promesa de mantenimiento que
// el equipo corporativo hereda, por un archivo que se abre igual.
function csv(filas, columnas) {
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linea = xs => xs.map(esc).join(',');
  return '\uFEFF' + [linea(columnas.map(c => c[1])),
    ...filas.map(f => linea(columnas.map(c => f[c[0]])))].join('\r\n');
}

function respuestaCsv(texto, nombre) {
  return new Response(texto, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nombre}"`,
    },
  });
}

export async function GET(req) {
  const { u, error } = await exigirAdmin();
  if (error) return error;

  const p = new URL(req.url).searchParams;
  const ent = p.get('entidad');
  const q = (p.get('q') ?? '').trim();
  const falta = p.get('falta') === '1';

  if (ent === 'resumen') {
    const [r] = await sql`
      select
        (select count(*) from sentinel.producto)                                        as productos,
        (select count(*) from sentinel.producto where unidades_por_caja is null)        as sin_caja,
        (select count(*) from sentinel.producto p
          where not exists (select 1 from sentinel.producto_barra b where b.producto_id = p.id)) as sin_barra,
        (select count(*) from sentinel.punto_venta where activo)                        as pdv,
        (select count(*) from sentinel.punto_venta where activo and supervisor_id is null) as pdv_sin_sup,
        (select count(*) from sentinel.punto_venta
          where activo and (cadena_grupo is null or cadena_grupo = 'OTROS'))            as pdv_sin_cadena,
        (select count(*) from sentinel.punto_venta where activo and por_clasificar)     as pdv_por_clasificar,
        (select count(*) from sentinel.usuario where activo)                            as usuarios,
        (select count(*) from sentinel.usuario where activo and rol = 'mercaderista')   as mercaderistas,
        (select count(*) from sentinel.caso where estado = 'cerrado' and corte_id is null) as cerrados_sin_corte,
        (select limite_cajas from sentinel.configuracion_autorizacion
          where nivel = 'supervisor' order by vigente_desde desc limit 1)               as limite_cajas`;
    return NextResponse.json({ resumen: r });
  }

  if (ent === 'usuarios') {
    const filas = await sql`
      select u.id, u.nombre, u.usuario, u.rol::text as rol, u.activo,
             u.debe_cambiar_clave, u.ultimo_acceso, u.bloqueado_hasta,
             (select string_agg(z.valor_ambito, ', ') from sentinel.usuario_zona z
               where z.usuario_id = u.id) as ambitos
      from sentinel.usuario u order by u.rol, u.nombre`;
    const regiones = await sql`
      select distinct valor_ambito as v from sentinel.usuario_zona
      where tipo_ambito = 'region' order by 1`;
    const cadenas = await sql`
      select distinct cadena_grupo as v from sentinel.punto_venta
      where cadena_grupo is not null order by 1`;
    return NextResponse.json({ filas,
      ambitos: { region: regiones.map(x => x.v), cadena: cadenas.map(x => x.v) } });
  }

  if (ent === 'productos') {
    const filas = await sql`
      select p.id, p.codigo_sap, p.descripcion, p.medida, p.unidades_por_caja, p.activo,
             p.upc_fuente,
             (select string_agg(b.codigo_barra, ', ') from sentinel.producto_barra b
               where b.producto_id = p.id) as barras
      from sentinel.producto p
      where (${!falta} or p.unidades_por_caja is null)
        and (${q === ''} or p.descripcion ilike ${'%' + q + '%'} or p.codigo_sap ilike ${q + '%'})
      order by (p.unidades_por_caja is null) desc, p.descripcion
      limit 150`;
    const [{ total }] = await sql`
      select count(*)::int as total from sentinel.producto p
      where (${!falta} or p.unidades_por_caja is null)
        and (${q === ''} or p.descripcion ilike ${'%' + q + '%'} or p.codigo_sap ilike ${q + '%'})`;
    return NextResponse.json({ filas, total });
  }

  if (ent === 'pdv' || ent === 'porclasificar') {
    const soloFaltan = ent === 'porclasificar';
    const filas = await sql`
      select pv.id, pv.codigo, pv.nombre, pv.cadena_grupo, pv.cadena_bd, pv.region,
             pv.activo, pv.por_clasificar,
             sup.nombre as supervisor_nombre, kam.nombre as kam_nombre
      from sentinel.punto_venta pv
      left join sentinel.usuario sup on sup.id = pv.supervisor_id
      left join sentinel.usuario kam on kam.id = pv.kam_id
      where (${!soloFaltan} or pv.por_clasificar)
        and (${q === ''} or pv.nombre ilike ${'%' + q + '%'} or pv.codigo like ${q + '%'})
      order by pv.nombre limit 150`;
    const [{ total }] = await sql`
      select count(*)::int as total from sentinel.punto_venta pv
      where (${!soloFaltan} or pv.por_clasificar)
        and (${q === ''} or pv.nombre ilike ${'%' + q + '%'} or pv.codigo like ${q + '%'})`;
    const cadenas = await sql`
      select distinct cadena_grupo as v from sentinel.punto_venta
      where cadena_grupo is not null order by 1`;
    const regiones = await sql`
      select distinct valor_ambito as v from sentinel.usuario_zona
      where tipo_ambito = 'region' order by 1`;
    return NextResponse.json({ filas, total,
      cadenas: cadenas.map(x => x.v), regiones: regiones.map(x => x.v) });
  }

  // Historial de casos cerrados. Sin esta pantalla un caso cerrado desaparecia
  // del sistema aunque los datos estuvieran completos.
  if (ent === 'cerrados') {
    const corte = (p.get('corte') ?? '').trim();
    const filas = await sql`
      select c.id as caso_id, c.cerrado_en, c.cantidad_inicial, c.cantidad_resuelta,
             c.cantidad_perdida, ca.nombre as causa, co.numero as corte,
             d.descripcion, d.pdv_nombre, d.cadena_grupo, d.fecha_vencimiento,
             ta.nombre as tipo_accion, ta.es_perdida, a.numero_vale,
             cer.nombre as cerrado_por
      from sentinel.caso c
      join sentinel.v_deteccion d on d.id = c.deteccion_id
      left join sentinel.causa ca on ca.id = c.causa_id
      left join sentinel.corte co on co.id = c.corte_id
      left join sentinel.usuario cer on cer.id = c.cerrado_por
      left join lateral (
        select * from sentinel.accion x where x.caso_id = c.id and x.estado = 'ejecutada'
        order by x.ejecutada_en desc limit 1) a on true
      left join sentinel.tipo_accion ta on ta.id = a.tipo_accion_id
      where c.estado = 'cerrado'
        and (${corte === ''} or co.numero = ${corte})
        and (${q === ''} or d.descripcion ilike ${'%' + q + '%'}
             or d.pdv_nombre ilike ${'%' + q + '%'})
      order by c.cerrado_en desc limit 200`;
    const cortes = await sql`select numero from sentinel.corte order by generado_en desc limit 50`;
    return NextResponse.json({ filas, cortes: cortes.map(c => c.numero) });
  }

  if (ent === 'cortes') {
    const filas = await sql`
      select co.id, co.numero, co.generado_en, co.casos_incluidos, co.unidades_incluidas,
             co.nota, u.nombre as generado_por
      from sentinel.corte co
      left join sentinel.usuario u on u.id = co.generado_por
      order by co.generado_en desc limit 100`;
    const [pendiente] = await sql`
      select count(*)::int as casos, coalesce(sum(cantidad_inicial),0)::int as unidades
      from sentinel.caso where estado = 'cerrado' and corte_id is null`;
    return NextResponse.json({ filas, pendiente });
  }

  // Descargas. El consolidado por cadena existe para convivir con el Excel que
  // la operacion ya sabe leer durante la transicion.
  if (ent === 'export') {
    const tipo = p.get('tipo');

    if (tipo === 'consolidado') {
      const filas = await sql`
        select cadena_grupo, pdv_nombre, pdv_codigo, descripcion, codigo_sap,
               cantidad, cajas, fecha_vencimiento, fecha_precision, dias_restantes,
               estado, supervisor_nombre, kam_nombre, capturado_por_nombre, capturado_en
        from sentinel.v_deteccion
        order by cadena_grupo nulls last, dias_restantes asc`;
      return respuestaCsv(csv(filas, [
        ['cadena_grupo', 'Cadena'], ['pdv_nombre', 'Tienda'], ['pdv_codigo', 'Código tienda'],
        ['descripcion', 'Producto'], ['codigo_sap', 'SAP'], ['cantidad', 'Unidades'],
        ['cajas', 'Cajas'], ['fecha_vencimiento', 'Vence'], ['fecha_precision', 'Precisión fecha'],
        ['dias_restantes', 'Días restantes'], ['estado', 'Estado'],
        ['supervisor_nombre', 'Supervisor'], ['kam_nombre', 'KAM'],
        ['capturado_por_nombre', 'Capturó'], ['capturado_en', 'Fecha captura'],
      ]), `consolidado_${new Date().toISOString().slice(0, 10)}.csv`);
    }

    if (tipo === 'corte') {
      const numero = (p.get('numero') ?? '').trim();
      const filas = await sql`
        select co.numero, c.id as caso_id, d.cadena_grupo, d.pdv_nombre, d.descripcion,
               d.codigo_sap, d.fecha_vencimiento, c.cantidad_inicial, c.cantidad_resuelta,
               c.cantidad_perdida, ta.nombre as accion, a.numero_vale, ca.nombre as causa,
               c.cerrado_en, cer.nombre as cerrado_por
        from sentinel.caso c
        join sentinel.corte co on co.id = c.corte_id
        join sentinel.v_deteccion d on d.id = c.deteccion_id
        left join sentinel.causa ca on ca.id = c.causa_id
        left join sentinel.usuario cer on cer.id = c.cerrado_por
        left join lateral (
          select * from sentinel.accion x where x.caso_id = c.id and x.estado = 'ejecutada'
          order by x.ejecutada_en desc limit 1) a on true
        left join sentinel.tipo_accion ta on ta.id = a.tipo_accion_id
        where co.numero = ${numero}
        order by d.cadena_grupo, d.pdv_nombre`;
      return respuestaCsv(csv(filas, [
        ['numero', 'Corte'], ['caso_id', 'Caso'], ['cadena_grupo', 'Cadena'],
        ['pdv_nombre', 'Tienda'], ['descripcion', 'Producto'], ['codigo_sap', 'SAP'],
        ['fecha_vencimiento', 'Vence'], ['cantidad_inicial', 'Unidades detectadas'],
        ['cantidad_resuelta', 'Recuperadas'], ['cantidad_perdida', 'Perdidas'],
        ['accion', 'Acción'], ['numero_vale', 'Vale'], ['causa', 'Causa'],
        ['cerrado_en', 'Cerrado'], ['cerrado_por', 'Cerró'],
      ]), `corte_${numero}.csv`);
    }

    return NextResponse.json({ error: 'Tipo de exportación no reconocido.' }, { status: 400 });
  }

  return NextResponse.json({ error: 'Entidad no reconocida.' }, { status: 400 });
}

export async function POST(req) {
  const { u, error } = await exigirAdmin();
  if (error) return error;
  const b = await req.json().catch(() => ({}));

  try {
    // Corte de consolidado. La restriccion cierre_requiere_causa impide cerrar
    // un caso sin causa, y la causa se pregunta al ejecutar: por eso el corte
    // NO cierra casos, estampa el numero de lote sobre lo que ya se cerro.
    if (b.entidad === 'corte') {
      const [pend] = await sql`
        select count(*)::int as casos from sentinel.caso
        where estado = 'cerrado' and corte_id is null`;
      if (!pend.casos)
        return NextResponse.json({ error: 'No hay casos cerrados pendientes de incluir en un corte.' },
          { status: 400 });

      const resultado = await sql.begin(async tx => {
        // Numero legible: fecha mas correlativo del dia. 20260921-01
        const [num] = await tx`
          select to_char(now(),'YYYYMMDD') || '-' ||
                 lpad(((select count(*) from sentinel.corte
                         where generado_en::date = current_date) + 1)::text, 2, '0') as numero`;
        const [co] = await tx`
          insert into sentinel.corte
            (numero, generado_por, casos_incluidos, unidades_incluidas, nota)
          values (${num.numero}, ${u.id}, 0, 0, ${b.nota || null})
          returning id, numero`;

        const inc = await tx`
          update sentinel.caso set corte_id = ${co.id}
          where estado = 'cerrado' and corte_id is null
          returning cantidad_inicial`;
        const unidades = inc.reduce((s, r) => s + Number(r.cantidad_inicial ?? 0), 0);
        await tx`
          update sentinel.corte
             set casos_incluidos = ${inc.length}, unidades_incluidas = ${unidades}
           where id = ${co.id}`;
        return { id: co.id, numero: num.numero, casos: inc.length, unidades };
      });

      await registrarBitacora({ usuarioId: u.id, entidad: 'corte', entidadId: resultado.id,
        accion: 'corte generado', despues: resultado });
      return NextResponse.json(resultado);
    }

    if (b.entidad === 'usuarios') {
      const nombre = String(b.nombre ?? '').trim();
      const usuario = String(b.usuario ?? '').trim().toLowerCase();
      if (!nombre || !usuario)
        return NextResponse.json({ error: 'Falta el nombre o el usuario.' }, { status: 400 });
      if (!ROLES.includes(b.rol))
        return NextResponse.json({ error: 'Ese rol no existe.' }, { status: 400 });

      const [nuevo] = await sql`
        insert into sentinel.usuario (nombre, usuario, rol, telefono)
        values (${nombre}, ${usuario}, ${b.rol}::sentinel.rol_usuario, ${b.telefono || null})
        returning id`;
      await sql`select sentinel.fijar_clave(${usuario}, ${'Merca2026'})`;
      await sql`update sentinel.usuario set debe_cambiar_clave = true where id = ${nuevo.id}`;
      if (b.ambito)
        await sql`
          insert into sentinel.usuario_zona (usuario_id, tipo_ambito, valor_ambito)
          values (${nuevo.id}, ${b.tipoAmbito || 'region'}::sentinel.tipo_ambito, ${b.ambito})
          on conflict do nothing`;
      await registrarBitacora({ usuarioId: u.id, entidad: 'usuario', entidadId: nuevo.id,
        accion: 'alta', despues: { nombre, usuario, rol: b.rol } });
      return NextResponse.json({ id: nuevo.id, claveTemporal: 'Merca2026' });
    }

    if (b.entidad === 'productos') {
      const sap = String(b.codigo_sap ?? '').trim();
      const desc = String(b.descripcion ?? '').trim();
      if (!sap || !desc)
        return NextResponse.json({ error: 'Falta el código SAP o la descripción.' }, { status: 400 });
      const [nuevo] = await sql`
        insert into sentinel.producto (codigo_sap, descripcion, medida, unidades_por_caja)
        values (${sap}, ${desc}, ${b.medida || 'UN'},
                ${b.unidades_por_caja ? Number(b.unidades_por_caja) : null})
        returning id`;
      await guardarBarras(nuevo.id, b.barras);
      await registrarBitacora({ usuarioId: u.id, entidad: 'producto', entidadId: nuevo.id,
        accion: 'alta', despues: { sap, desc } });
      return NextResponse.json({ id: nuevo.id });
    }

    return NextResponse.json({ error: 'Entidad no reconocida.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: traducir(e) }, { status: 400 });
  }
}

export async function PATCH(req) {
  const { u, error } = await exigirAdmin();
  if (error) return error;
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  if (!id) return NextResponse.json({ error: 'Falta el registro a modificar.' }, { status: 400 });

  try {
    if (b.entidad === 'usuarios') {
      if (b.accion === 'clave') {
        const [usr] = await sql`select usuario from sentinel.usuario where id = ${id}`;
        if (!usr) return NextResponse.json({ error: 'Ese usuario no existe.' }, { status: 404 });
        await sql`select sentinel.fijar_clave(${usr.usuario}, ${'Merca2026'})`;
        await sql`update sentinel.usuario set debe_cambiar_clave = true,
                    intentos_fallidos = 0, bloqueado_hasta = null where id = ${id}`;
        await sql`delete from sentinel.sesion where usuario_id = ${id}`;
        await registrarBitacora({ usuarioId: u.id, entidad: 'usuario', entidadId: id,
          accion: 'restablecer clave' });
        return NextResponse.json({ ok: true, claveTemporal: 'Merca2026' });
      }
      if (b.accion === 'desbloquear') {
        await sql`update sentinel.usuario set intentos_fallidos = 0, bloqueado_hasta = null
                   where id = ${id}`;
        return NextResponse.json({ ok: true });
      }
      if (b.accion === 'activo') {
        // Nunca se borra: las capturas históricas deben seguir apuntando a alguien.
        await sql`update sentinel.usuario set activo = ${!!b.activo} where id = ${id}`;
        if (!b.activo) await sql`delete from sentinel.sesion where usuario_id = ${id}`;
        await registrarBitacora({ usuarioId: u.id, entidad: 'usuario', entidadId: id,
          accion: b.activo ? 'activar' : 'desactivar' });
        return NextResponse.json({ ok: true });
      }
      if (!ROLES.includes(b.rol))
        return NextResponse.json({ error: 'Ese rol no existe.' }, { status: 400 });
      await sql`
        update sentinel.usuario
           set nombre = ${String(b.nombre).trim()},
               rol = ${b.rol}::sentinel.rol_usuario,
               telefono = ${b.telefono || null}
         where id = ${id}`;
      if (b.ambito !== undefined) {
        await sql`delete from sentinel.usuario_zona where usuario_id = ${id}`;
        if (b.ambito)
          await sql`
            insert into sentinel.usuario_zona (usuario_id, tipo_ambito, valor_ambito)
            values (${id}, ${b.tipoAmbito || 'region'}::sentinel.tipo_ambito, ${b.ambito})`;
      }
      await registrarBitacora({ usuarioId: u.id, entidad: 'usuario', entidadId: id,
        accion: 'modificacion', despues: { nombre: b.nombre, rol: b.rol } });
      return NextResponse.json({ ok: true });
    }

    if (b.entidad === 'productos') {
      await sql`
        update sentinel.producto
           set descripcion = ${String(b.descripcion).trim()},
               medida = ${b.medida || 'UN'},
               unidades_por_caja = ${b.unidades_por_caja ? Number(b.unidades_por_caja) : null},
               activo = ${b.activo !== false},
               actualizado_en = now()
         where id = ${id}`;
      if (b.barras !== undefined) await guardarBarras(id, b.barras);
      await registrarBitacora({ usuarioId: u.id, entidad: 'producto', entidadId: id,
        accion: 'modificacion', despues: { unidades_por_caja: b.unidades_por_caja } });
      return NextResponse.json({ ok: true });
    }

    if (b.entidad === 'pdv' || b.entidad === 'porclasificar') {
      // Supervisor y KAM ya NO se asignan a mano: los deriva el trigger desde
      // cadena_grupo y region. Editarlos a mano rompia la consistencia y dejaba
      // tiendas apuntando a alguien que no las atiende.
      const [antes] = await sql`
        select nombre, cadena_grupo, region, activo from sentinel.punto_venta where id = ${id}`;
      const [pv] = await sql`
        update sentinel.punto_venta
           set nombre = ${String(b.nombre ?? antes.nombre).trim()},
               cadena_grupo = ${b.cadena_grupo || null},
               region = ${b.region || null},
               activo = ${b.activo !== false}
         where id = ${id}
         returning cadena_grupo, region, kam_id, supervisor_id, por_clasificar`;
      await registrarBitacora({ usuarioId: u.id, entidad: 'punto_venta', entidadId: id,
        accion: 'modificacion', antes, despues: pv });
      return NextResponse.json({ ok: true, derivado: pv });
    }

    return NextResponse.json({ error: 'Entidad no reconocida.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: traducir(e) }, { status: 400 });
  }
}

// Los códigos se normalizan igual que al escanear: sin espacios ni ceros a la
// izquierda. Si no, el catálogo y la cámara no se entienden.
async function guardarBarras(productoId, texto) {
  const lista = String(texto ?? '')
    .split(',')
    .map(x => x.replace(/[^0-9]/g, '').replace(/^0+/, ''))
    .filter(Boolean);
  await sql`delete from sentinel.producto_barra where producto_id = ${productoId}`;
  for (const b of lista) {
    await sql`
      insert into sentinel.producto_barra (producto_id, codigo_barra)
      values (${productoId}, ${b}) on conflict (codigo_barra) do nothing`;
  }
}

function traducir(e) {
  const m = String(e?.message ?? '');
  if (m.includes('usuario_usuario_key')) return 'Ese nombre de usuario ya existe.';
  if (m.includes('producto_codigo_sap_key')) return 'Ese código SAP ya existe.';
  if (m.includes('punto_venta_codigo_key')) return 'Ese código de tienda ya existe.';
  if (m.includes('producto_upc_positivo')) return 'Las unidades por caja deben ser mayores a cero.';
  if (m.includes('cierre_requiere_causa')) return 'Un caso no se puede cerrar sin causa.';
  console.error('maestros', e);
  return 'No se pudo guardar. Revisa los datos.';
}
