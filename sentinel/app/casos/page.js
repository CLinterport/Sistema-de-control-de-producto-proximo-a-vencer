import { redirect } from 'next/navigation';
import { usuarioActual } from '@/lib/sesion';
import Casos from './Casos';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const u = await usuarioActual();
  if (!u) redirect('/');
  return <Casos usuario={{ nombre: u.nombre, rol: u.rol }} />;
}
