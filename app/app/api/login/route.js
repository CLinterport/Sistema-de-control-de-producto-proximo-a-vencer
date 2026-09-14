import { NextResponse } from 'next/server';
import { sql, registrarBitacora } from '@/lib/db';
import { crearSesion } from '@/lib/sesion';

export async function POST(req) {
  const { usuario, clave } = await req.json().catch(() => ({}));
  if (!usuario || !clave)
    return NextResponse.json({ error: 'Escribe tu usuario y tu clave.' }, { status: 400 });

  const filas = await sql`select * from pvencer.validar_clave(${usuario}, ${clave})`;
  if (!filas.length) {
    // Mismo mensaje para usuario inexistente y para clave mala: no se le revela
    // a nadie si un usuario existe. Tras 5 intentos la base bloquea 15 minutos.
    return NextResponse.json(
      { error: 'Usuario o clave incorrectos. Tras varios intentos la cuenta se bloquea unos minutos.' },
      { status: 401 });
  }
  const u = filas[0];
  await crearSesion(u.id, req.headers.get('user-agent'));
  await registrarBitacora({ usuarioId: u.id, entidad: 'sesion', entidadId: u.id,
    accion: 'ingreso', ip: req.headers.get('x-forwarded-for') });
  return NextResponse.json({ nombre: u.nombre, rol: u.rol, debeCambiar: u.debe_cambiar });
}
