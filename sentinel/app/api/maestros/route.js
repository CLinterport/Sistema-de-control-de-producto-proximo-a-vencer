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
        (select count(*) from sentinel.usuario where activo)                            as usuarios,
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
    return NextResponse.json({ filas });
  }

  if (ent === 'productos') {
    const filas = await sql`
      select p.id, p.codigo_sap, p.descripcion, p.medida, p.unidades_por_caja, p.activo,
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

  if (ent === 'pdv') {
    const filas = await sql`
      select pv.id, pv.codigo, pv.nombre, pv.cadena_grupo, pv.region, pv.activo,
             pv.supervisor_id, pv.kam_id,
             sup.nombre as supervisor_nombre, kam.nombre as kam_nombre
      from sentinel.punto_venta pv
      left join sentinel.usuario sup on sup.id = pv.supervisor_id
      left join sentinel.usuario kam on kam.id = pv.kam_id
      where (${q === ''} or pv.nombre ilike ${'%' + q + '%'} or pv.codigo like ${q + '%'})
      order by pv.nombre limit 150`;
    const [{ total }] = await sql`
      select count(*)::int as total from sentinel.punto_venta pv
      where (${q === ''} or pv.nombre ilike ${'%' + q + '%'} or pv.codigo like ${q + '%'})`;
    const responsables = await sql`
      select id, nombre, rol::text as rol from sentinel.usuario
      where activo and rol in ('supervisor','kam') order by rol, nombre`;
    return NextResponse.json({ filas, total, responsables });
  }

  return NextResponse.json({ error: 'Entidad no reconocida.' }, { status: 400 });
}

// Crear
export async function POST(req) {
  const { u, error } = await exigirAdmin();
  if (error) return error;
  const b = await req.json().catch(() => ({}));

  try {
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
      // Clave temporal; la app obliga a cambiarla al primer ingreso.
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

// Modificar
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

    if (b.entidad === 'pdv') {
      await sql`
        update sentinel.punto_venta
           set nombre = ${String(b.nombre).trim()},
               cadena_grupo = ${b.cadena_grupo || null},
               region = ${b.region || null},
               supervisor_id = ${b.supervisor_id ? Number(b.supervisor_id) : null},
               kam_id = ${b.kam_id ? Number(b.kam_id) : null},
               activo = ${b.activo !== false}
         where id = ${id}`;
      await registrarBitacora({ usuarioId: u.id, entidad: 'punto_venta', entidadId: id,
        accion: 'modificacion', despues: { supervisor_id: b.supervisor_id, kam_id: b.kam_id } });
      return NextResponse.json({ ok: true });
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
  console.error('maestros', e);
  return 'No se pudo guardar. Revisa los datos.';
}
