'use client';
import { useCallback, useEffect, useState } from 'react';

const ROLES = ['mercaderista', 'supervisor_jr', 'supervisor', 'kam', 'gerencia', 'administrador'];
// Los roles que trabajan por region contra los que trabajan por cadena. De esto
// depende a quien le llegan los casos, asi que se elige, no se escribe libre.
const AMBITO_DE = { mercaderista: 'region', supervisor_jr: 'region', supervisor: 'region', kam: 'cadena' };
const TABS = [
  { k: 'resumen', t: 'Resumen' },
  { k: 'porclasificar', t: 'Por clasificar' },
  { k: 'usuarios', t: 'Usuarios' },
  { k: 'productos', t: 'Productos' },
  { k: 'pdv', t: 'Puntos de venta' },
  { k: 'cerrados', t: 'Casos cerrados' },
  { k: 'cortes', t: 'Cortes' },
];
const fechaHora = v => v ? new Date(v).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' }) : '';

export default function Maestros({ usuario }) {
  const [tab, setTab] = useState('resumen');
  const [q, setQ] = useState('');
  const [falta, setFalta] = useState(false);
  const [corte, setCorte] = useState('');
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const url = `/api/maestros?entidad=${tab}&q=${encodeURIComponent(q)}`
        + `&falta=${falta ? 1 : 0}&corte=${encodeURIComponent(corte)}`;
      const r = await fetch(url);
      const d = await r.json();
      setDatos(r.ok ? d : { error: d.error });
    } catch {
      setDatos({ error: 'No se pudo consultar. Revisa tu conexión.' });
    } finally { setCargando(false); }
  }, [tab, q, falta, corte]);

  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [cargar]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 3200);
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

  async function generarCorte() {
    const r = await fetch('/api/maestros', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entidad: 'corte' }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setAviso(d.error ?? 'No se pudo generar el corte.'); return; }
    setAviso(`Corte ${d.numero}: ${d.casos} casos, ${d.unidades} unidades`);
    cargar();
  }

  const conBuscador = ['productos', 'pdv', 'porclasificar', 'cerrados'].includes(tab);

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
          <div className="tienda">Maestros</div>
          <div className="who">{usuario.nombre} · administrador</div>
        </div>
      </div>

      <div className="tabs tabs-top" style={{ flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.k} className={tab === t.k ? 'on' : ''}
                  onClick={() => { setTab(t.k); setQ(''); setFalta(false); setCorte(''); setDatos(null); }}>
            {t.t}
          </button>
        ))}
      </div>

      <main>
        {datos?.error && <div className="err" role="alert">{datos.error}</div>}

        {tab === 'resumen' && <Resumen r={datos?.resumen} cargando={cargando} irA={setTab} />}

        {conBuscador && (
          <div className="tools">
            <input type="search" placeholder="Buscar" value={q} onChange={e => setQ(e.target.value)} />
            {tab === 'productos' && (
              <label className="chk">
                <input type="checkbox" checked={falta} onChange={e => setFalta(e.target.checked)} />
                Solo los que faltan
              </label>
            )}
            {tab === 'cerrados' && (
              <select value={corte} onChange={e => setCorte(e.target.value)}
                      style={{ width: 'auto', minWidth: 160 }}>
                <option value="">Todos los cortes</option>
                {datos?.cortes?.map(c => <option key={c} value={c}>Corte {c}</option>)}
              </select>
            )}
            {tab === 'productos' && (
              <button className="btn compacto" onClick={() => setEditando({ nuevo: true })}>Agregar</button>
            )}
          </div>
        )}

        {tab === 'usuarios' && (
          <div className="tools">
            <button className="btn compacto" onClick={() => setEditando({ nuevo: true })}>
              Agregar usuario
            </button>
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
        {(tab === 'pdv' || tab === 'porclasificar') && datos?.filas && (<>
          {tab === 'porclasificar' && (
            <div className="nota">
              Al poner cadena y región, el sistema asigna solo el KAM y el supervisor de zona.
              Ya no se eligen a mano: asignarlos por separado dejaba tiendas apuntando a
              alguien que no las atiende.
            </div>
          )}
          <Tabla filas={datos.filas} total={datos.total} onEditar={setEditando} tipo="pdv" />
        </>)}
        {tab === 'cerrados' && datos?.filas && <Cerrados filas={datos.filas} />}
        {tab === 'cortes' && datos?.filas && (
          <Cortes filas={datos.filas} pendiente={datos.pendiente} onGenerar={generarCorte} />
        )}
      </main>

      {editando && (
        <Editor tab={tab} reg={editando} opciones={datos ?? {}}
                onCerrar={() => setEditando(null)}
                onGuardar={async (cuerpo) => {
                  const d = await enviar(editando.nuevo ? 'POST' : 'PATCH', cuerpo);
                  if (d.error) return d.error;
                  setEditando(null);
                  setAviso(d.claveTemporal ? `Creado. Clave temporal: ${d.claveTemporal}`
                    : d.derivado?.por_clasificar === false ? 'Guardado. Ya tiene KAM y supervisor.'
                    : 'Guardado');
                  cargar();
                  return null;
                }} />
      )}

      {aviso && <div className="toast" role="status">{aviso}</div>}
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
      <div className={`kpi ${r.pdv_por_clasificar > 0 ? 'alerta' : ''}`} onClick={() => irA('porclasificar')}>
        <div className="n">{Number(r.pdv_por_clasificar).toLocaleString('es-GT')}</div>
        <div className="l">tiendas por clasificar</div>
      </div>
      <div className={`kpi ${r.mercaderistas === 0 ? 'alerta' : ''}`} onClick={() => irA('usuarios')}>
        <div className="n">{r.mercaderistas}</div><div className="l">mercaderistas cargados</div>
      </div>
      <div className={`kpi ${r.sin_barra > 0 ? 'alerta' : ''}`}>
        <div className="n">{r.sin_barra}</div><div className="l">productos sin código de barras</div>
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
      <div className="kpi"><div className="n">{r.cerrados_sin_corte}</div>
        <div className="l">casos cerrados sin corte</div></div>
    </div>
    <div className="tools">
      <a className="btn compacto ghost" href="/api/maestros?entidad=export&tipo=consolidado">
        Descargar consolidado
      </a>
    </div>
    <p className="sub">
      El consolidado sale en el formato que la operación ya sabe leer, para convivir con el
      Excel actual durante la transición.
    </p>
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
              {tipo === 'productos' ? f.descripcion : f.nombre}
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
                  ? `${f.unidades_por_caja} por caja${f.upc_fuente === 'supervisor' ? ' (confirmado en campo)' : ''}`
                  : <span className="tag t-falta">falta caja</span>}
                {f.barras ? ` · ${f.barras.slice(0, 30)}` : <span className="tag t-falta"> sin código</span>}
              </>)}
              {tipo === 'pdv' && (<>
                {f.codigo} · {f.cadena_grupo ?? <span className="tag t-falta">sin cadena</span>}
                {' · '}{f.region ?? <span className="tag t-falta">sin región</span>}
                {' · '}{f.kam_nombre ? `KAM ${f.kam_nombre}` : <span className="tag t-falta">sin KAM</span>}
                {f.supervisor_nombre ? ` · ${f.supervisor_nombre}` : ''}
              </>)}
            </div>
          </div>
          <div className="acc">
            <button className="btn ghost compacto" onClick={() => onEditar(f)}>Editar</button>
            {tipo === 'usuarios' && (<>
              <button className="btn ghost compacto" onClick={() => onAccion(f.id, 'clave')}>Clave</button>
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

// Un caso cerrado desaparecia del sistema aunque los datos estuvieran completos.
// Esta es la unica pantalla donde se ve el resultado de todo el ciclo.
function Cerrados({ filas }) {
  if (!filas.length) return <div className="vacio">Todavía no hay casos cerrados.</div>;
  const tot = filas.reduce((a, f) => ({
    ini: a.ini + Number(f.cantidad_inicial ?? 0),
    res: a.res + Number(f.cantidad_resuelta ?? 0),
    per: a.per + Number(f.cantidad_perdida ?? 0),
  }), { ini: 0, res: 0, per: 0 });
  const pct = tot.ini ? Math.round((tot.res / tot.ini) * 100) : 0;

  return (<>
    <div className="kpis">
      <div className="kpi"><div className="n">{filas.length}</div><div className="l">casos cerrados</div></div>
      <div className="kpi"><div className="n">{tot.res.toLocaleString('es-GT')}</div>
        <div className="l">unidades recuperadas</div></div>
      <div className="kpi"><div className="n">{tot.per.toLocaleString('es-GT')}</div>
        <div className="l">unidades perdidas</div></div>
      <div className="kpi"><div className="n">{pct}%</div>
        <div className="l">de lo detectado se recuperó</div></div>
    </div>
    <div className="list">
      {filas.map(f => (
        <div key={f.caso_id} className="fila">
          <div className="info">
            <div className="nm">{f.descripcion ?? 'Sin catálogo'}</div>
            <div className="mt">
              {f.pdv_nombre} · {f.tipo_accion ?? 'sin acción'} · {f.cantidad_resuelta} recuperadas,
              {' '}{f.cantidad_perdida} perdidas de {f.cantidad_inicial}
            </div>
            <div className="hist">
              Causa: {f.causa ?? 'sin causa'} · cerró {f.cerrado_por ?? '—'} el {fechaHora(f.cerrado_en)}
              {f.numero_vale ? ` · vale ${f.numero_vale}` : ''}
              {f.corte ? ` · corte ${f.corte}` : ' · sin corte'}
            </div>
          </div>
        </div>
      ))}
    </div>
  </>);
}

function Cortes({ filas, pendiente, onGenerar }) {
  return (<>
    <h2>Cortes de consolidado</h2>
    <p className="sub">
      Un corte le pone número de lote a los casos ya cerrados y los deja congelados para
      reportar. No borra ni cierra nada: un caso solo se cierra cuando alguien registra la
      causa al ejecutar la acción.
    </p>
    <div className="kpis">
      <div className={`kpi ${pendiente?.casos > 0 ? 'alerta' : ''}`}>
        <div className="n">{pendiente?.casos ?? 0}</div>
        <div className="l">casos cerrados esperando corte</div>
      </div>
      <div className="kpi">
        <div className="n">{Number(pendiente?.unidades ?? 0).toLocaleString('es-GT')}</div>
        <div className="l">unidades en esos casos</div>
      </div>
    </div>
    <div className="tools">
      <button className="btn compacto" disabled={!pendiente?.casos} onClick={onGenerar}>
        Generar corte
      </button>
    </div>
    {filas.length ? (
      <div className="list">
        {filas.map(f => (
          <div key={f.id} className="fila">
            <div className="info">
              <div className="nm">Corte {f.numero}</div>
              <div className="mt">
                {f.casos_incluidos} casos · {Number(f.unidades_incluidas).toLocaleString('es-GT')} unidades
                {' · '}generó {f.generado_por ?? '—'} el {fechaHora(f.generado_en)}
              </div>
            </div>
            <div className="acc">
              <a className="btn ghost compacto"
                 href={`/api/maestros?entidad=export&tipo=corte&numero=${encodeURIComponent(f.numero)}`}>
                Descargar
              </a>
            </div>
          </div>
        ))}
      </div>
    ) : <div className="vacio">Todavía no se ha generado ningún corte.</div>}
  </>);
}

function Editor({ tab, reg, opciones, onCerrar, onGuardar }) {
  const [f, setF] = useState({
    nombre: reg.nombre ?? '', usuario: reg.usuario ?? '', rol: reg.rol ?? 'mercaderista',
    telefono: reg.telefono ?? '', ambito: reg.ambitos ?? '',
    codigo_sap: reg.codigo_sap ?? '', descripcion: reg.descripcion ?? '',
    medida: reg.medida ?? 'UN', unidades_por_caja: reg.unidades_por_caja ?? '',
    barras: reg.barras ?? '', cadena_grupo: reg.cadena_grupo ?? '', region: reg.region ?? '',
    activo: reg.activo !== false,
  });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));

  const tipoAmbito = AMBITO_DE[f.rol] ?? 'region';
  const listaAmbito = opciones.ambitos?.[tipoAmbito] ?? [];

  async function guardar() {
    setError(''); setGuardando(true);
    const err = await onGuardar({ id: reg.id, tipoAmbito, ...f });
    if (err) setError(err);
    setGuardando(false);
  }

  const esPdv = tab === 'pdv' || tab === 'porclasificar';

  return (
    <div className="modal" onClick={e => { if (e.target.className === 'modal') onCerrar(); }}>
      <div className="caja" role="dialog" aria-label={reg.nuevo ? 'Agregar' : 'Editar'}>
        <div className="ch">{reg.nuevo ? 'Agregar' : 'Editar'}</div>
        <div className="cb">
          {error && <div className="err" role="alert">{error}</div>}

          {tab === 'usuarios' && (<>
            <Campo l="Nombre" v={f.nombre} on={v => set('nombre', v)} />
            {reg.nuevo && <Campo l="Usuario para entrar" v={f.usuario}
                                 on={v => set('usuario', v.toLowerCase())} ph="ej: jperez" />}
            <label className="campo"><span>Rol</span>
              <select value={f.rol} onChange={e => set('rol', e.target.value)}>
                {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
              </select></label>
            <label className="campo">
              <span>{tipoAmbito === 'cadena' ? 'Cadena que atiende' : 'Región que atiende'}</span>
              <select value={f.ambito} onChange={e => set('ambito', e.target.value)}>
                <option value="">sin ámbito</option>
                {listaAmbito.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <span>
                {tipoAmbito === 'cadena'
                  ? 'El KAM trabaja por cadena. De aquí sale a quién escalan los casos.'
                  : 'De aquí salen las tiendas que se le proponen al capturar y los casos que ve.'}
              </span>
            </label>
            <Campo l="Teléfono" v={f.telefono} on={v => set('telefono', v)} />
            {reg.nuevo && <p className="sub">Se crea con clave temporal Merca2026 y se le obliga a cambiarla.</p>}
          </>)}

          {tab === 'productos' && (<>
            <Campo l="Descripción" v={f.descripcion} on={v => set('descripcion', v)} />
            {reg.nuevo && <Campo l="Código SAP" v={f.codigo_sap} on={v => set('codigo_sap', v)} />}
            <Campo l="Unidades por caja" v={f.unidades_por_caja} tipo="number"
                   on={v => set('unidades_por_caja', v)} ph="ej: 24" />
            <Campo l="Códigos de barra, separados por coma" v={f.barras} on={v => set('barras', v)} />
            <label className="campo"><span>Medida</span>
              <select value={f.medida} onChange={e => set('medida', e.target.value)}>
                <option value="UN">UN — se vende por unidad</option>
                <option value="CJ">CJ — se vende por caja</option>
              </select>
              <span>Define en qué arranca el selector de la pantalla de captura.</span>
            </label>
          </>)}

          {esPdv && (<>
            <Campo l="Nombre de la tienda" v={f.nombre} on={v => set('nombre', v)} />
            <label className="campo"><span>Cadena</span>
              <select value={f.cadena_grupo ?? ''} onChange={e => set('cadena_grupo', e.target.value)}>
                <option value="">sin cadena</option>
                {(opciones.cadenas ?? []).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <span>Define el KAM.</span>
            </label>
            <label className="campo"><span>Región</span>
              <select value={f.region ?? ''} onChange={e => set('region', e.target.value)}>
                <option value="">sin región</option>
                {(opciones.regiones ?? []).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <span>Define el supervisor de zona.</span>
            </label>
            {reg.cadena_bd && <p className="sub">Cadena original del catálogo: {reg.cadena_bd}</p>}
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
