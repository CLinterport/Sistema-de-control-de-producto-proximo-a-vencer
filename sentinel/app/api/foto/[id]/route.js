import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { usuarioActual } from '@/lib/sesion';

// La foto se sirve por aqui y no como dato de la deteccion: si viajara dentro
// de v_deteccion, cada lista de casos arrastraria decenas de imagenes.
export async function GET(req, { params }) {
  const u = await usuarioActual();
  if (!u) return NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 });

  const id = Number((await params).id);
  if (!id) return NextResponse.json({ error: 'Falta la detección.' }, { status: 400 });

  const [f] = await sql`
    select contenido, tipo from sentinel.deteccion_foto where deteccion_id = ${id}`;
  if (!f) return NextResponse.json({ error: 'Esa detección no tiene foto.' }, { status: 404 });

  const bin = Buffer.from(f.contenido, 'base64');
  return new Response(bin, {
    headers: {
      'Content-Type': f.tipo,
      'Content-Length': String(bin.length),
      // Privada: es evidencia de un cliente, no debe quedar en caches compartidos.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
