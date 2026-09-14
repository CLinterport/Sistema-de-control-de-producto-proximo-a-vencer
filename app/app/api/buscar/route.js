import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { usuarioActual } from '@/lib/sesion';

// Busca tiendas y productos. Un solo endpoint para no multiplicar llamadas
// desde un telefono con red movil.
export async function GET(req) {
  const u = await usuarioActual();
  if (!u) return NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const tipo = searchParams.get('tipo');
  const q = (searchParams.get('q') ?? '').trim();

  if (tipo === 'pdv') {
    // Sin texto, se proponen las tiendas de la zona del usuario: es lo que
    // va a tocar el 90% de las veces.
    const filas = q
      ? await sql`
          select id, codigo, nombre, cadena_grupo from pvencer.punto_venta
          where activo and (nombre ilike ${'%' + q + '%'} or codigo like ${q + '%'})
          order by nombre limit 25`
      : await sql`
          select pv.id, pv.codigo, pv.nombre, pv.cadena_grupo from pvencer.punto_venta pv
          where pv.activo and (pv.supervisor_id = ${u.id} or ${u.rol} in ('administrador','gerencia'))
          order by pv.nombre limit 25`;
    return NextResponse.json({ filas });
  }

  if (tipo === 'producto') {
    if (q.length < 2) return NextResponse.json({ filas: [] });
    const filas = await sql`
      select distinct p.id, p.codigo_sap, p.descripcion, p.unidades_por_caja
      from pvencer.producto p
      left join pvencer.producto_barra b on b.producto_id = p.id
      where p.activo and (p.descripcion ilike ${'%' + q + '%'}
                          or p.codigo_sap ilike ${q + '%'}
                          or b.codigo_barra like ${q + '%'})
      order by p.descripcion limit 20`;
    return NextResponse.json({ filas });
  }

  if (tipo === 'barra') {
    // La normalizacion vive en la base, para que el navegador y el servidor
    // no puedan discrepar: quita espacios y ceros a la izquierda.
    const [fila] = await sql`
      select p.id, p.codigo_sap, p.descripcion, p.unidades_por_caja
      from pvencer.producto_barra b
      join pvencer.producto p on p.id = b.producto_id
      where b.codigo_barra = pvencer.normalizar_barra(${q})
      limit 1`;
    return NextResponse.json({ fila: fila ?? null });
  }

  return NextResponse.json({ error: 'Tipo de búsqueda no reconocido.' }, { status: 400 });
}
