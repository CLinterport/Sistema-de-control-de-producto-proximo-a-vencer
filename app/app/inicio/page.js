import Link from 'next/link';
import { redirect } from 'next/navigation';
import { usuarioActual, PUEDE_CAPTURAR } from '@/lib/sesion';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Inicio() {
  const u = await usuarioActual();
  if (!u) redirect('/');

  const [r] = await sql`
    select
      count(*) filter (where estado = 'en_riesgo') as en_riesgo,
      count(*) filter (where estado = 'critico')   as critico,
      count(*) filter (where estado = 'vencido')   as vencido,
      coalesce(sum(cantidad), 0)                   as unidades
    from pvencer.v_deteccion`;

  return (
    <div className="movil">
      <div className="bar">
        <div>
          <div className="who">{u.rol.replace('_', ' ')}</div>
          <div className="tienda">{u.nombre}</div>
        </div>
      </div>
      <main>
        <div>
          <h1>Hoy</h1>
          <p className="sub">Situación de las tiendas que te corresponden.</p>
        </div>
        <div className="list">
          <div className="row" style={{ cursor: 'default' }}>
            <div style={{ flex: 1 }}><div className="nm">En riesgo</div>
              <div className="mt">entre 8 y 21 días</div></div>
            <span className="pill p-en_riesgo">{r.en_riesgo}</span>
          </div>
          <div className="row" style={{ cursor: 'default' }}>
            <div style={{ flex: 1 }}><div className="nm">Crítico</div>
              <div className="mt">7 días o menos</div></div>
            <span className="pill p-critico">{r.critico}</span>
          </div>
          <div className="row" style={{ cursor: 'default' }}>
            <div style={{ flex: 1 }}><div className="nm">Vencido</div>
              <div className="mt">ya no se puede recuperar</div></div>
            <span className="pill p-vencido">{r.vencido}</span>
          </div>
        </div>
        {PUEDE_CAPTURAR.has(u.rol) && (
          <Link href="/capturar" className="btn" style={{ textDecoration: 'none' }}>
            Capturar en tienda
          </Link>
        )}
        <p className="sub">{Number(r.unidades).toLocaleString('es-GT')} unidades bajo seguimiento.</p>
      </main>
    </div>
  );
}
