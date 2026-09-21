'use client';
import { useEffect, useState } from 'react';

const num = n => Number(n ?? 0).toLocaleString('es-GT');
const TXT = { vivo: 'Vivo', en_riesgo: 'En riesgo', critico: 'Crítico', vencido: 'Vencido' };

export default function Tablero({ usuario }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/tablero')
      .then(async r => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'No se pudo cargar.');
        setD(j);
      })
      .catch(e => setError(e.message));
  }, []);

  if (error) return <Marco usuario={usuario}><div className="err" role="alert">{error}</div></Marco>;
  if (!d) return <Marco usuario={usuario}><div className="vacio">Cargando…</div></Marco>;

  const i = d.indicador;
  const pct = i.detectadas ? Math.round((i.resueltas_vivas / i.detectadas) * 100) : null;
  const sinDatos = !i.detectadas;

  return (
    <Marco usuario={usuario}>
      {/* El unico numero que se le muestra a gerencia. Todo lo demas explica
          por que ese numero es el que es. */}
      <div className={`estado ${pct > 0 ? 'e-vivo' : 'e-en_riesgo'}`}
           style={{ padding: '18px 20px' }}>
        <div style={{ fontSize: 40, fontWeight: 650, letterSpacing: '-.02em', lineHeight: 1.1 }}>
          {sinDatos ? '—' : `${pct}%`}
        </div>
        <div className="x" style={{ fontSize: 15 }}>
          de lo detectado se resolvió mientras el producto seguía vivo
        </div>
      </div>
      <p className="sub">
        {sinDatos
          ? 'Todavía no hay casos. El indicador aparece en cuanto se capture la primera línea que abra caso.'
          : <>
              {num(i.resueltas_vivas)} unidades recuperadas a tiempo de {num(i.detectadas)} detectadas.
              {' '}{num(i.detectadas_vivas)} llegaron vivas al sistema; el resto ya estaba vencido
              cuando alguien lo reportó, y sobre eso ya no se puede hacer nada comercial.
            </>}
      </p>

      <h2>Qué hay que mover hoy</h2>
      <div className="list">
        <Cola n={d.hoy.sin_propuesta} un={d.hoy.un_sin_propuesta} dias={d.hoy.espera_sin_propuesta}
              t="Sin propuesta" s="nadie ha dicho qué hacer con ese producto" />
        <Cola n={d.hoy.esperando_firma} dias={d.hoy.espera_firma}
              t="Esperando firma" s="propuesto y sin autorizar" />
        <Cola n={d.hoy.por_ejecutar}
              t="Autorizado sin ejecutar" s="la acción está aprobada y el producto sigue en el anaquel" />
        <Cola n={d.hoy.criticos} un={d.hoy.un_criticos}
              t="Críticos" s="7 días o menos para vencer" alerta />
        <Cola n={d.hoy.vencidos} un={d.hoy.un_vencidos}
              t="Ya vencidos" s="pasan a vale y destrucción" alerta />
      </div>

      {d.urgentes.length > 0 && (<>
        <h2>Los doce más urgentes</h2>
        <div className="list">
          {d.urgentes.map(f => (
            <div key={f.caso_id} className="fila">
              <div className="info">
                <div className="nm">{f.descripcion ?? 'Sin catálogo'}</div>
                <div className="mt">
                  {f.pdv_nombre} · {num(f.cantidad)} unidades
                  {f.supervisor_nombre ? ` · ${f.supervisor_nombre}` : ' · sin supervisor'}
                  {f.kam_nombre ? ` · KAM ${f.kam_nombre}` : ''}
                  {!f.estado_accion ? ' · sin propuesta' : ''}
                </div>
              </div>
              <div className="acc">
                <span className={`pill p-${f.estado}`}>{TXT[f.estado]} · {f.dias_restantes} d</span>
              </div>
            </div>
          ))}
        </div>
      </>)}

      <h2>Dónde está el riesgo</h2>
      <Cuadro filas={d.cadena} clave="cadena" segunda="kam_nombre"
              vacio="Sin líneas capturadas todavía." />
      <Cuadro filas={d.supervisor} clave="supervisor_nombre" segunda="region"
              vacio="Sin supervisor asignado a lo capturado." />

      {d.cobertura.length > 0 && (<>
        <h2>Tiendas que dejaron de reportar</h2>
        <p className="sub">
          La visita es cada 3 días. Cuatro días o más sin una sola captura significa que
          alguien pasó por ahí y no registró nada.
        </p>
        <div className="list">
          {d.cobertura.map(c => (
            <div key={c.nombre} className="fila">
              <div className="info">
                <div className="nm">{c.nombre}</div>
                <div className="mt">{c.cadena_grupo ?? 'sin cadena'} · {c.region ?? 'sin región'}</div>
              </div>
              <div className="acc"><span className="pill p-en_riesgo">{c.dias_sin_captura} d</span></div>
            </div>
          ))}
        </div>
      </>)}

      <h2>Cuánto tarda el ciclo</h2>
      {d.ciclo?.acciones ? (
        <div className="kpis">
          <Kpi n={d.ciclo.dias_ciclo} l="días de detección a ejecución" />
          <Kpi n={d.ciclo.a_propuesta} l="días hasta que alguien propone" />
          <Kpi n={d.ciclo.a_autorizacion} l="días hasta la firma" />
          <Kpi n={d.ciclo.a_ejecucion} l="días hasta ejecutar" />
        </div>
      ) : (
        <div className="vacio">Todavía no hay acciones completas para medir el ciclo.</div>
      )}

      {d.causas.length > 0 && (<>
        <h2>Por qué se está venciendo</h2>
        <div className="list">
          {d.causas.map(c => (
            <div key={c.nombre} className="fila">
              <div className="info"><div className="nm">{c.nombre}</div>
                <div className="mt">{num(c.unidades)} unidades perdidas</div></div>
              <div className="acc"><span className="pill p-vencido">{c.veces}</span></div>
            </div>
          ))}
        </div>
      </>)}

      <div className="nota">
        <b>Este tablero todavía no habla de dinero.</b> {d.dinero.con_costo} de{' '}
        {d.dinero.productos} productos tienen costo unitario cargado. El día que exista la
        lista de precios, todo lo de arriba se vuelve a calcular en quetzales sin tocar una
        línea de código, incluido lo histórico.
      </div>
      <p className="sub">Actualizado {new Date(d.generado).toLocaleString('es-GT')}</p>
    </Marco>
  );
}

function Marco({ usuario, children }) {
  return (
    <div className="ancho">
      <div className="bar">
        <a className="atras" href="/inicio" aria-label="Regresar">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </a>
        <div>
          <div className="tienda">Tablero</div>
          <div className="who">{usuario.nombre} · {usuario.rol}</div>
        </div>
      </div>
      <main>{children}</main>
    </div>
  );
}

function Cola({ n, un, dias, t, s, alerta }) {
  return (
    <a className="fila" href="/casos" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="info">
        <div className="nm">{t}</div>
        <div className="mt">
          {s}
          {un ? ` · ${num(un)} unidades` : ''}
          {dias ? ` · el más viejo lleva ${dias} días` : ''}
        </div>
      </div>
      <div className="acc">
        <span className={`pill ${n > 0 ? (alerta ? 'p-critico' : 'p-en_riesgo') : 'p-vivo'}`}>{num(n)}</span>
      </div>
    </a>
  );
}

function Cuadro({ filas, clave, segunda, vacio }) {
  if (!filas.length) return <div className="vacio">{vacio}</div>;
  return (
    <div className="list">
      {filas.map((f, k) => (
        <div key={k} className="fila">
          <div className="info">
            <div className="nm">{f[clave] ?? 'sin asignar'}</div>
            <div className="mt">
              {f[segunda] ?? '—'} · {num(f.unidades)} unidades en {num(f.total_lineas)} líneas
            </div>
          </div>
          <div className="acc">
            {f.critico > 0 && <span className="pill p-critico">{f.critico} crít</span>}
            {f.en_riesgo > 0 && <span className="pill p-en_riesgo">{f.en_riesgo} riesgo</span>}
            {f.vencido > 0 && <span className="pill p-vencido">{f.vencido} venc</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Kpi({ n, l }) {
  return <div className="kpi"><div className="n">{n ?? '—'}</div><div className="l">{l}</div></div>;
}
