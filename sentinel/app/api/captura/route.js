import { NextResponse } from 'next/server';
import { sql, registrarBitacora } from '@/lib/db';
import { usuarioActual, PUEDE_CAPTURAR } from '@/lib/sesion';

// Lo capturado hoy en una tienda, para que el mercaderista no duplique
export async function GET(req) {
  const u = await usuarioActual();
  if (!u) return NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 });
  const pdv = new URL(req.url).searchParams.get('pdv');
  if (!pdv) return NextResponse.json({ filas: [] });

  const filas = await sql`
    select id, descripcion, cantidad, fecha_vencimiento, dias_restantes, estado,
           cajas, sin_cruce_catalogo
    from sentinel.v_deteccion
    where punto_venta_id = ${pdv}::bigint
    order by dias_restantes asc limit 100`;
  return NextResponse.json({ filas });
}

export async function POST(req) {
  const u = await usuarioActual();
  if (!u) return NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 });
  if (!PUEDE_CAPTURAR.has(u.rol))
    return NextResponse.json({ error: 'Tu rol no captura en tienda.' }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const pdvId = Number(b.pdvId);
  const cantidad = Number(b.cantidad);
  const venc = String(b.vencimiento ?? '');
  const productoId = b.productoId ? Number(b.productoId) : null;
  const barra = b.barra ? String(b.barra) : null;

  if (!pdvId) return NextResponse.json({ error: 'Falta la tienda.' }, { status: 400 });
  if (!Number.isInteger(cantidad) || cantidad < 1)
    return NextResponse.json({ error: 'La cantidad debe ser un número mayor a cero.' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venc))
    return NextResponse.json({ error: 'Falta la fecha de vencimiento.' }, { status: 400 });
  if (!productoId && !barra)
    return NextResponse.json({ error: 'Falta el producto o el código escaneado.' }, { status: 400 });

  try {
    const resultado = await sql.begin(async (tx) => {
      // Si ese producto con esa fecha ya se capturo en esa tienda, NO se duplica:
      // se actualiza la cantidad y se guarda la observacion en el historial.
      // De ahi sale la rotacion real medida en anaquel.
      const [existente] = productoId
        ? await tx`
            select id, cantidad from sentinel.deteccion
            where punto_venta_id = ${pdvId} and producto_id = ${productoId}
              and fecha_vencimiento = ${venc}::date and estado_registro = 'activa'
            limit 1`
        : [];

      if (existente) {
        // La cantidad solo puede bajar o quedar igual. Si sube, es producto
        // nuevo del mismo lote y el cliente ya lo confirmo explicitamente.
        if (cantidad > existente.cantidad && !b.confirmaAumento) {
          return { requiereConfirmacion: true, anterior: existente.cantidad };
        }
        await tx`
          update sentinel.deteccion
             set cantidad = ${cantidad}, ultima_actualizacion = now(), actualizado_por = ${u.id}
           where id = ${existente.id}`;
        await tx`
          insert into sentinel.deteccion_historial (deteccion_id, cantidad, observado_por)
          values (${existente.id}, ${cantidad}, ${u.id})`;
        return { id: existente.id, actualizado: true, anterior: existente.cantidad };
      }

      const [nueva] = await tx`
        insert into sentinel.deteccion
          (punto_venta_id, producto_id, codigo_barra_capturado, cantidad, fecha_vencimiento, capturado_por)
        values (${pdvId}, ${productoId}, ${barra}, ${cantidad}, ${venc}::date, ${u.id})
        returning id`;
      await tx`
        insert into sentinel.deteccion_historial (deteccion_id, cantidad, observado_por)
        values (${nueva.id}, ${cantidad}, ${u.id})`;

      // El caso se abre solo si el estado lo exige. Lo "vivo" solo se monitorea.
      await tx`
        insert into sentinel.caso (deteccion_id, responsable_id, cantidad_inicial)
        select ${nueva.id}, pv.supervisor_id, ${cantidad}
        from sentinel.punto_venta pv
        where pv.id = ${pdvId}
          and coalesce(sentinel.estado_por_dias((${venc}::date - current_date)::integer), 'vencido') <> 'vivo'
        on conflict (deteccion_id) do nothing`;

      return { id: nueva.id, actualizado: false };
    });

    if (resultado.requiereConfirmacion) return NextResponse.json(resultado);

    await registrarBitacora({
      usuarioId: u.id, entidad: 'deteccion', entidadId: resultado.id,
      accion: resultado.actualizado ? 'actualizacion de cantidad' : 'captura',
      despues: { cantidad, vencimiento: venc, pdvId },
      ip: req.headers.get('x-forwarded-for'),
    });
    return NextResponse.json(resultado);
  } catch (e) {
    console.error('captura', e);
    // Los mensajes de la base son tecnicos; se traducen a algo accionable.
    const msg = String(e.message ?? '');
    if (msg.includes('venc_razonable'))
      return NextResponse.json({ error: 'Esa fecha de vencimiento no es posible. Revisa el año.' }, { status: 400 });
    if (msg.includes('cantidad_positiva'))
      return NextResponse.json({ error: 'La cantidad debe ser mayor a cero.' }, { status: 400 });
    return NextResponse.json({ error: 'No se pudo guardar. Intenta de nuevo.' }, { status: 500 });
  }
}
