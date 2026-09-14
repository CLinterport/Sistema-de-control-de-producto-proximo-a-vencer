import { NextResponse } from 'next/server';
import { sql, registrarBitacora } from '@/lib/db';
import { usuarioActual } from '@/lib/sesion';

export async function POST(req) {
  const u = await usuarioActual();
  if (!u) return NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 });
  const { nueva } = await req.json().catch(() => ({}));
  if (!nueva || nueva.length < 8)
    return NextResponse.json({ error: 'La clave debe tener al menos 8 caracteres.' }, { status: 400 });
  await sql`select sentinel.fijar_clave(${u.usuario}, ${nueva})`;
  await registrarBitacora({ usuarioId: u.id, entidad: 'usuario', entidadId: u.id, accion: 'cambio de clave' });
  return NextResponse.json({ ok: true });
}
