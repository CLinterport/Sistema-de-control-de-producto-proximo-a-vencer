import { cookies } from 'next/headers';
import { sql } from './db';

const COOKIE = 'pv_sesion';

export async function crearSesion(usuarioId, agente) {
  const [s] = await sql`
    insert into pvencer.sesion (usuario_id, agente)
    values (${usuarioId}, ${agente ?? null})
    returning id, expira_en`;
  const jar = await cookies();
  jar.set(COOKIE, s.id, {
    httpOnly: true,             // el navegador no puede leerla desde JavaScript
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(s.expira_en),
  });
  return s.id;
}

// Devuelve el usuario de la sesion vigente, o null.
// Se consulta en cada peticion: si el administrador desactiva a alguien,
// deja de entrar en el momento, no cuando expire la cookie.
export async function usuarioActual() {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (!id) return null;
  try {
    const [u] = await sql`
      update pvencer.sesion s set ultimo_uso = now()
      from pvencer.usuario u
      where s.id = ${id}::uuid
        and s.usuario_id = u.id
        and s.expira_en > now()
        and u.activo
      returning u.id, u.nombre, u.usuario, u.rol, u.debe_cambiar_clave`;
    return u ?? null;
  } catch {
    return null;
  }
}

export async function cerrarSesion() {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (id) {
    try { await sql`delete from pvencer.sesion where id = ${id}::uuid`; } catch {}
  }
  jar.delete(COOKIE);
}

// Quien puede ver que. Mercaderista y supervisor jr capturan; los demas consultan.
export const PUEDE_CAPTURAR = new Set(['mercaderista', 'supervisor_jr', 'supervisor', 'administrador']);
export const ES_ADMIN = new Set(['administrador']);

export async function exigirUsuario() {
  const u = await usuarioActual();
  if (!u) throw new Error('sin sesion');
  return u;
}
