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
    // Sin texto se proponen tiendas. Antes se filtraba por punto_venta.supervisor_id,
    // que ahora es derivado y apunta al supervisor de zona, no a quien captura:
    // para los 7 supervisores jr la lista salia vacia. Ahora se proponen las
    // tiendas donde esa persona ya capturo, primero las mas recientes, y si no
    // ha capturado nunca, las de su region.
    const filas = q
      ? await sql`
          select id, codigo, nombre, cadena_grupo, region from sentinel.punto_venta
          where activo and (nombre ilike ${'%' + q + '%'} or codigo like ${q + '%'})
          order by nombre limit 25`
      : await sql`
          with mias as (
            select d.punto_venta_id, max(d.capturado_en) as ultima
            from sentinel.deteccion d
            where d.capturado_por = ${u.id}
            group by 1),
          zona as (
            select valor_ambito from sentinel.usuario_zona
            where usuario_id = ${u.id} and tipo_ambito = 'region')
          select pv.id, pv.codigo, pv.nombre, pv.cadena_grupo, pv.region,
                 m.ultima is not null as reciente
          from sentinel.punto_venta pv
          left join mias m on m.punto_venta_id = pv.id
          where pv.activo
            and (m.punto_venta_id is not null
                 or pv.region in (select valor_ambito from zona)
                 or ${u.rol} in ('administrador','gerencia'))
          order by m.ultima desc nulls last, pv.nombre
          limit 25`;
    return NextResponse.json({ filas });
  }

  if (tipo === 'producto') {
    if (q.length < 2) return NextResponse.json({ filas: [] });
    const filas = await sql`
      select distinct p.id, p.codigo_sap, p.descripcion, p.unidades_por_caja, p.medida
      from sentinel.producto p
      left join sentinel.producto_barra b on b.producto_id = p.id
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
      select p.id, p.codigo_sap, p.descripcion, p.unidades_por_caja, p.medida
      from sentinel.producto_barra b
      join sentinel.producto p on p.id = b.producto_id
      where b.codigo_barra = sentinel.normalizar_barra(${q})
      limit 1`;
    return NextResponse.json({ fila: fila ?? null });
  }

  return NextResponse.json({ error: 'Tipo de búsqueda no reconocido.' }, { status: 400 });
}
