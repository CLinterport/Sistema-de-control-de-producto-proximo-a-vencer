'use client';
import { useCallback, useEffect, useState } from 'react';

const ROLES = ['mercaderista', 'supervisor_jr', 'supervisor', 'kam', 'gerencia', 'administrador'];
const CADENAS = ['', 'UNISUPER', 'SUMA / GTA', 'WALMART', 'PAIZ', 'C-STORE', 'OASIS', 'OTROS'];
const TABS = [
  { k: 'resumen', t: 'Resumen' },
  { k: 'usuarios', t: 'Usuarios' },
  { k: 'productos', t: 'Productos' },
  { k: 'pdv', t: 'Puntos de venta' },
];

export default function Maestros({ usuario }) {
  const [tab, setTab] = useState('resumen');
  const [q, setQ] = useState('');
  const [falta, setFalta] = useState(false);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const url = `/api/maestros?entidad=${tab}&q=${encodeURIComponent(q)}&falta=${falta ? 1 : 0}`;
      const r = await fetch(url);
      const d = await r.json();
      setDatos(r.ok ? d : { error: d.error });
    } catch {
      setDatos({ error: 'No se pudo consultar. Revisa tu conexión.' });
    } finally { setCargando(false); }
  }, [tab, q, falta]);

  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [cargar]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 2400);
    return () => clearTimeout(t);
  }, [aviso]);

  async function enviar(metodo, cuerpo) {
    const r = await fetch('/api/maestros', {
      method: metodo, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entidad: tab, ...cuerpo }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { error: d.error ?? 'No se pudo guardar.' };
    return d;
  }

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
          <div className="who">{usuario.nombre} · administrador</div>
          <div className="tienda">Maestros</div>
        </div>
      </div>

      <div className="tabs tabs-top">
        {TABS.map(t => (
          <button key={t.k} className={tab === t.k ? 'on' : ''}
                  onClick={() => { setTab(t.k); setQ(''); setFalta(false); setDatos(null); }}>
            {t.t}
          </button>
        ))}
      </div>

      <main>
        {datos?.error && <div className="err">{datos.error}</div>}

        {tab === 'resumen' && <Resumen r={datos?.resumen} cargando={cargando} irA={setTab} />}

        {tab !== 'resumen' && (
          <div className="tools">
            <input type="search" placeholder={tab === 'usuarios' ? 'Buscar no aplica aquí' : 'Buscar'}
                   value={q} onChange={e => setQ(e.target.value)}
                   disabled={tab === 'usuarios'} />
            {tab === 'productos' && (
              <label className="chk">
                <input type="checkbox" checked={falta} onChange={e => setFalta(e.target.checked)} />
                Solo los que faltan
              </label>
            )}
            {tab !== 'pdv' && (
              <button className="btn compacto" onClick={() => setEditando({ nuevo: true })}>
                Agregar
              </button>
            )}
          </div>
        )}

        {cargando && !datos && <div className="vacio">Cargando…</div>}

        {tab === 'usuarios' && datos?.filas && (
          <Tabla filas={datos.filas} onEditar={setEditando} tipo="usuarios"
                 onAccion={async (id, accion, extra) => {
                   const d = await enviar('PATCH', { id, accion, ...extra });
                   setAviso(d.error ?? (d.claveTemporal
                     ? `Clave restablecida a ${d.claveTemporal}` : 'Guardado'));
                   cargar();
                 }} />
        )}
        {tab === 'productos' && datos?.filas && (
          <Tabla filas={datos.filas} total={datos.total} onEditar={setEditando} tipo="productos" />
        )}
        {tab === 'pdv' && datos?.filas && (
          <Tabla filas={datos.filas} total={datos.total} onEditar={setEditando} tipo="pdv" />
        )}
      </main>

      {editando && (
        <Editor tab={tab} reg={editando} responsables={datos?.responsables ?? []}
                onCerrar={() => setEditando(null)}
                onGuardar={async (cuerpo) => {
                  const d = await enviar(editando.nuevo ? 'POST' : 'PATCH', cuerpo);
                  if (d.error) return d.error;
                  setEditando(null);
                  setAviso(d.claveTemporal ? `Creado. Clave temporal: ${d.claveTemporal}` : 'Guardado');
                  cargar();
                  return null;
                }} />
      )}

      {aviso && <div className="toast">{aviso}</div>}
    </div>
  );
}

function Resumen({ r, cargando, irA }) {
  if (cargando || !r) return <div className="vacio">Cargando…</div>;
  return (<>
    <h2>Qué falta en los catálogos</h2>
    <p className="sub">
      El sistema funciona sin esto, pero algunas reglas no se pueden aplicar hasta completarlo.
    </p>
    <div className="kpis">
      <div className={`kpi ${r.sin_caja > 0 ? 'alerta' : ''}`} onClick={() => irA('productos')}>
        <div className="n">{r.sin_caja}</div><div className="l">productos sin unidades por caja</div>
      </div>
      <div className={`kpi ${r.sin_barra > 0 ? 'alerta' : ''}`}>
        <div className="n">{r.sin_barra}</div><div className="l">productos sin código de barras</div>
      </div>
      <div className={`kpi ${r.pdv_sin_sup > 0 ? 'alerta' : ''}`} onClick={() => irA('pdv')}>
        <div className="n">{r.pdv_sin_sup}</div><div className="l">tiendas sin supervisor</div>
      </div>
      <div className={`kpi ${r.pdv_sin_cadena > 0 ? 'alerta' : ''}`}>
        <div className="n">{r.pdv_sin_cadena}</div><div className="l">tiendas sin cadena</div>
      </div>
    </div>
    <div className="nota">
      <b>Por qué importan las unidades por caja.</b> La regla dice que hasta {r.limite_cajas} cajas
      autoriza el supervisor y más de eso pasa al KAM. Un producto sin ese dato no se puede convertir
      de unidades a cajas, así que el sistema lo escala al KAM por precaución. Mientras queden {r.sin_caja}
      {' '}productos así, el KAM va a recibir casi todo y el límite deja de filtrar.
    </div>
    <div className="kpis">
      <div className="kpi"><div className="n">{r.productos}</div><div className="l">productos</div></div>
      <div className="kpi"><div className="n">{Number(r.pdv).toLocaleString('es-GT')}</div>
        <div className="l">puntos de venta</div></div>
      <div className="kpi"><div className="n">{r.usuarios}</div><div className="l">usuarios activos</div></div>
      <div className="kpi"><div className="n">{r.limite_cajas}</div>
        <div className="l">cajas de límite del supervisor</div></div>
    </div>
  </>);
}

function Tabla({ filas, total, onEditar, onAccion, tipo }) {
  if (!filas.length) return <div className="vacio">No hay registros que coincidan.</div>;
  return (<>
    <div className="list">
      {filas.map(f => (
        <div key={f.id} className="fila">
          <div className="info">
            <div className="nm">
              {tipo === 'usuarios' ? f.nombre : tipo === 'productos' ? f.descripcion : f.nombre}
              {f.activo === false && <span className="tag t-off">inactivo</span>}
            </div>
            <div className="mt">
              {tipo === 'usuarios' && (<>
                {f.usuario} · <span className="tag t-rol">{f.rol.replace('_', ' ')}</span>
                {f.ambitos ? ` · ${f.ambitos}` : ' · sin ámbito'}
                {f.debe_cambiar_clave ? ' · clave temporal' : ''}
                {f.bloqueado_hasta ? ' · bloqueado' : ''}
              </>)}
              {tipo === 'productos' && (<>
                {f.codigo_sap} ·{' '}
                {f.unidades_por_caja
                  ? `${f.unidades_por_caja} por caja`
                  : <span className="tag t-falta">falta caja</span>}
                {f.barras ? ` · ${f.barras.slice(0, 30)}` : <span className="tag t-falta"> sin código</span>}
              </>)}
              {tipo === 'pdv' && (<>
                {f.codigo} · {f.cadena_grupo ?? <span className="tag t-falta">sin cadena</span>}
                {' · '}{f.supervisor_nombre ?? <span className="tag t-falta">sin supervisor</span>}
                {f.kam_nombre ? ` · KAM ${f.kam_nombre}` : ''}
              </>)}
            </div>
          </div>
          <div className="acc">
            <button className="btn ghost compacto" onClick={() => onEditar(f)}>Editar</button>
            {tipo === 'usuarios' && (<>
              <button className="btn ghost compacto"
                      onClick={() => onAccion(f.id, 'clave')}>Clave</button>
              <button className="btn ghost compacto"
                      onClick={() => onAccion(f.id, 'activo', { activo: !f.activo })}>
                {f.activo ? 'Desactivar' : 'Activar'}
              </button>
            </>)}
          </div>
        </div>
      ))}
    </div>
    <p className="sub">
      Mostrando {filas.length}{total ? ` de ${total}` : ''}
      {total > filas.length ? ' · afina la búsqueda para ver el resto' : ''}
    </p>
  </>);
}

function Editor({ tab, reg, responsables, onCerrar, onGuardar }) {
  const [f, setF] = useState({
    nombre: reg.nombre ?? '', usuario: reg.usuario ?? '', rol: reg.rol ?? 'mercaderista',
    telefono: reg.telefono ?? '', ambito: reg.ambitos ?? '',
    codigo_sap: reg.codigo_sap ?? '', descripcion: reg.descripcion ?? '',
    medida: reg.medida ?? 'UN', unidades_por_caja: reg.unidades_por_caja ?? '',
    barras: reg.barras ?? '', cadena_grupo: reg.cadena_grupo ?? '', region: reg.region ?? '',
    supervisor_id: reg.supervisor_id ?? '', kam_id: reg.kam_id ?? '',
    activo: reg.activo !== false,
  });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));

  async function guardar() {
    setError(''); setGuardando(true);
    const err = await onGuardar({ id: reg.id, ...f });
    if (err) setError(err);
    setGuardando(false);
  }

  const sups = responsables.filter(r => r.rol === 'supervisor');
  const kams = responsables.filter(r => r.rol === 'kam');

  return (
    <div className="modal" onClick={e => { if (e.target.className === 'modal') onCerrar(); }}>
      <div className="caja">
        <div className="ch">{reg.nuevo ? 'Agregar' : 'Editar'}</div>
        <div className="cb">
          {error && <div className="err">{error}</div>}

          {tab === 'usuarios' && (<>
            <Campo l="Nombre" v={f.nombre} on={v => set('nombre', v)} />
            {reg.nuevo && <Campo l="Usuario para entrar" v={f.usuario}
                                 on={v => set('usuario', v.toLowerCase())} />}
            <label className="campo"><span>Rol</span>
              <select value={f.rol} onChange={e => set('rol', e.target.value)}>
                {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
              </select></label>
            <Campo l="Ámbito: región o cadena" v={f.ambito} on={v => set('ambito', v)} />
            <Campo l="Teléfono" v={f.telefono} on={v => set('telefono', v)} />
            {reg.nuevo && <p className="sub">Se crea con clave temporal Merca2026 y se le obliga a cambiarla.</p>}
          </>)}

          {tab === 'productos' && (<>
            <Campo l="Descripción" v={f.descripcion} on={v => set('descripcion', v)} />
            {reg.nuevo && <Campo l="Código SAP" v={f.codigo_sap} on={v => set('codigo_sap', v)} />}
            <Campo l="Unidades por caja" v={f.unidades_por_caja} tipo="number"
                   on={v => set('unidades_por_caja', v)} ph="ej: 24" />
            <Campo l="Códigos de barra, separados por coma" v={f.barras} on={v => set('barras', v)} />
            <Campo l="Medida" v={f.medida} on={v => set('medida', v)} />
          </>)}

          {tab === 'pdv' && (<>
            <Campo l="Nombre de la tienda" v={f.nombre} on={v => set('nombre', v)} />
            <label className="campo"><span>Cadena consolidada</span>
              <select value={f.cadena_grupo ?? ''} onChange={e => set('cadena_grupo', e.target.value)}>
                {CADENAS.map(c => <option key={c} value={c}>{c || 'sin cadena'}</option>)}
              </select></label>
            <Campo l="Región" v={f.region} on={v => set('region', v)} />
            <label className="campo"><span>Supervisor</span>
              <select value={f.supervisor_id ?? ''} onChange={e => set('supervisor_id', e.target.value)}>
                <option value="">sin supervisor</option>
                {sups.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select></label>
            <label className="campo"><span>KAM</span>
              <select value={f.kam_id ?? ''} onChange={e => set('kam_id', e.target.value)}>
                <option value="">sin KAM</option>
                {kams.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select></label>
          </>)}
        </div>
        <div className="cf">
          <button className="btn ghost compacto" onClick={onCerrar}>Cancelar</button>
          <button className="btn compacto" disabled={guardando} onClick={guardar}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Campo({ l, v, on, tipo = 'text', ph = '' }) {
  return (
    <label className="campo"><span>{l}</span>
      <input type={tipo} value={v ?? ''} placeholder={ph} onChange={e => on(e.target.value)} />
    </label>
  );
}
