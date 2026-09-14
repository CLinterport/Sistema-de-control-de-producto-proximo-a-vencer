import { redirect } from 'next/navigation';
import { usuarioActual } from '@/lib/sesion';
import Maestros from './Maestros';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const u = await usuarioActual();
  if (!u) redirect('/');
  // El control vive en el servidor. Ocultar un enlace no es un control de acceso.
  if (u.rol !== 'administrador') redirect('/inicio');
  return <Maestros usuario={{ nombre: u.nombre }} />;
}
