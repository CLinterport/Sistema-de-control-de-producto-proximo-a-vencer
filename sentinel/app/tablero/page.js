import { redirect } from 'next/navigation';
import { usuarioActual } from '@/lib/sesion';
import Tablero from './Tablero';

export const dynamic = 'force-dynamic';

// El control de rol va aqui y tambien en la API. Si solo estuviera aqui,
// bastaria pedir /api/tablero a mano para ver todo.
export default async function Pagina() {
  const u = await usuarioActual();
  if (!u) redirect('/');
  if (!['gerencia', 'administrador'].includes(u.rol)) redirect('/inicio');
  return <Tablero usuario={{ nombre: u.nombre, rol: u.rol }} />;
}
