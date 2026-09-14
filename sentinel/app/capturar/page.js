import { redirect } from 'next/navigation';
import { usuarioActual, PUEDE_CAPTURAR } from '@/lib/sesion';
import Captura from './Captura';

// La sesion se valida en el servidor antes de mandar nada al navegador.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const u = await usuarioActual();
  if (!u) redirect('/');
  if (!PUEDE_CAPTURAR.has(u.rol)) redirect('/inicio');
  return <Captura usuario={{ nombre: u.nombre, rol: u.rol }} />;
}
