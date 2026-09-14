'use client';
import { useCallback, useEffect, useState } from 'react';

const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const fechaCorta = iso => {
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${Number(d)} ${MESES[Number(m) - 1]} ${a}`;
};
const unidades = n => `${n} ${Number(n) === 1 ? 'unidad' : 'unidades'}`;

// Cada rol entra directo a su bandeja. Ver pestañas que no le tocan solo estorba.
const BANDEJAS = {
  supervisor_jr: [['sin_propuesta', 'Por proponer'], ['todos', 'Todos']],
  supervisor:    [['revision_supervisor', 'Por revisar'], ['sin_propuesta', 'Sin propuesta'], ['todos', 'Todos']],
  kam:           [['revision_kam', 'Por autorizar'], ['todos', 'Todos']],
  mercaderista:  [['por_ejecutar', 'Por hacer']],
  gerencia:      [['todos', 'Todos']],
  administrador: [['todos', 'Todos'], ['sin_propuesta', 'Sin propuesta'],
                  ['revision_supervisor', 'Con supervisor'], ['revision_kam', 'Con KAM'],
                  ['por_ejecutar', 'Por hacer']],
};

export default function Casos({ usuario }) {
  const [bandeja, setBandeja] = useState(BANDEJAS[usuario.rol]?.[0]?.[0] ?? 'todos');
  const [d, setD] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState(null);
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch(`/api/casos?bandeja=${bandeja}`);
      const j = await r.json();
      setD(r.ok ? j : { error: j.error, filas: [] });
    } catch {
      setD({ error: 'No se pudo consultar. Revisa tu conexión.', filas: [] });
    } finally { setCargando(false); }
  }, [bandeja]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 2600);
    return () => clearTimeout(t);
  }, [aviso]);

  async function enviar(metodo, cuerpo) {
    const r = await fetch('/api/casos', {
      method: metodo, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: j.error ?? 'No se pudo completar.' };
    return j;
  }

  const tabs = BANDEJAS[usuario.rol] ?? [['todos', 'Todos']];
  const c = d?.conteos ?? {};

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
          <div className="who">{usuario.nombre} · {usuario.rol.replace('_', ' ')}</div>
          <div className="tienda">Casos</div>
        </div>
      </div>

      {tabs.length > 1 && (
        <div className="tabs tabs-top">
          {tabs.map(([k, t]) => (
            <button key={k} className={bandeja === k ? 'on' : ''} onClick={() => setBandeja(k)}>
              {t}{c[k] ? ` · ${c[k]}` : ''}
            </button>
          ))}
        </div>
      )}

      <main>
        {d?.error && <div className="err">{d.error}</div>}
        {cargando && <div className="vacio">Cargando…</div>}

        {!cargando && d?.filas?.length === 0 && (
          <div className="vacio">
            {bandeja === 'sin_propuesta' ? 'No hay casos esperando propuesta.'
              : bandeja === 'revision_supervisor' ? 'Nada pendiente de revisar.'
              : bandeja === 'revision_kam' ? 'Nada pendiente de autorizar.'
              : bandeja === 'por_ejecutar' ? 'No tienes instrucciones pendientes. Sigue capturando.'
              : 'No hay casos abiertos.'}
          </div>
        )}

        {!cargando && d?.filas?.map(f => (
          <Caso key={f.caso_id} f={f} rol={usuario.rol} limite={d.limiteCajas}
                onAccion={(tipo) => setModal({ tipo, f })} />
        ))}
      </main>

      {modal && (
        <Modal m={modal} d={d} onCerrar={() => setModal(null)}
               onEnviar={async (metodo, cuerpo) => {
                 const r = await enviar(metodo, cuerpo);
                 if (r.error) return r.error;
                 setModal(null);
                 setAviso(r.perdida ? 'Registrado como pérdida' : 'Listo');
                 cargar();
                 return null;
               }} />
      )}
      {aviso && <div className="toast">{aviso}</div>}
    </div>
  );
}

function Caso({ f, rol, limite, onAccion }) {
  const superaLimite = f.nivel_requerido === 'kam';
  return (
    <div className="fila caso">
      <div className="info">
        <div className="nm">{f.descripcion ?? 'Sin catálogo'}</div>
        <div className="mt">
          {f.pdv_nombre} · {unidades(f.cantidad)}
          {f.cajas ? ` · ${f.cajas} cajas` : ' · caja sin definir'}
          {' · vence '}{fechaCorta(f.fecha_vencimiento)}
        </div>
        {f.accion_id && (
          <div className="hist">
            {f.tipo_accion} por {unidades(f.cantidad_unidades)}
            {f.cantidad_cajas ? ` (${f.cantidad_cajas} cajas)` : ''}
            {f.propuesta_por ? ` · propuso ${f.propuesta_por}` : ''}
            {f.autorizada_por ? ` · autorizó ${f.autorizada_por}` : ''}
          </div>
        )}
      </div>
      <div className="acc">
        <span className={`pill p-${f.estado}`}>{f.dias_restantes} d</span>

        {!f.accion_id && ['supervisor_jr', 'supervisor', 'administrador'].includes(rol) && (
          <button className="btn compacto" onClick={() => onAccion('proponer')}>Proponer</button>
        )}

        {f.estado_accion === 'en_revision_supervisor' && ['supervisor', 'administrador'].includes(rol) && (
          superaLimite
            ? <button className="btn compacto" onClick={() => onAccion('escalar')}>
                Trasladar al KAM
              </button>
            : <button className="btn compacto" onClick={() => onAccion('autorizar')}>Autorizar</button>
        )}

        {f.estado_accion === 'en_revision_kam' && ['kam', 'administrador'].includes(rol) && (
          <button className="btn compacto" onClick={() => onAccion('autorizar')}>Autorizar</button>
        )}

        {['en_revision_supervisor', 'en_revision_kam'].includes(f.estado_accion)
          && ['supervisor', 'kam', 'administrador'].includes(rol) && (
          <button className="btn ghost compacto" onClick={() => onAccion('rechazar')}>Rechazar</button>
        )}

        {f.estado_accion === 'autorizada' && (
          <button className="btn compacto" onClick={() => onAccion('ejecutar')}>Marcar hecho</button>
        )}

        {f.estado_accion === 'en_revision_kam' && rol !== 'kam' && rol !== 'administrador' && (
          <span className="tag t-rol">con el KAM</span>
        )}
        {f.estado_accion === 'en_revision_supervisor' && !['supervisor','administrador'].includes(rol) && (
          <span className="tag t-rol">con el supervisor</span>
        )}
      </div>
    </div>
  );
}

function Modal({ m, d, onCerrar, onEnviar }) {
  const { tipo, f } = m;
  const [tipoAccionId, setTipoAccionId] = useState(d.acciones?.[1]?.id ?? d.acciones?.[0]?.id ?? '');
  const [un, setUn] = useState(String(f.cantidad ?? ''));
  const [motivo, setMotivo] = useState('');
  const [movidas, setMovidas] = useState(String(f.cantidad_unidades ?? ''));
  const [vale, setVale] = useState('');
  const [causaId, setCausaId] = useState(d.causas?.[1]?.id ?? '');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Avisa antes de proponer si la cantidad va a escalar al KAM
  const cajas = f.unidades_por_caja ? (Number(un) / f.unidades_por_caja) : null;
  const escalaKam = cajas === null || cajas > d.limiteCajas;

  const titulos = {
    proponer: 'Proponer acción', autorizar: 'Autorizar', escalar: 'Trasladar al KAM',
    rechazar: 'Rechazar', ejecutar: 'Confirmar ejecución',
  };

  async function enviar() {
    setError(''); setEnviando(true);
    let err = null;
    if (tipo === 'proponer')
      err = await onEnviar('POST', { casoId: f.caso_id, tipoAccionId, unidades: Number(un) });
    else if (tipo === 'ejecutar')
      err = await onEnviar('PATCH', { accionId: f.accion_id, accion: 'ejecutar',
        movidas: Number(movidas), numeroVale: vale, causaId });
    else if (tipo === 'rechazar')
      err = await onEnviar('PATCH', { accionId: f.accion_id, accion: 'rechazar', motivo });
    else
      err = await onEnviar('PATCH', { accionId: f.accion_id, accion: tipo });
    if (err) setError(err);
    setEnviando(false);
  }

  return (
    <div className="modal" onClick={e => { if (e.target.className === 'modal') onCerrar(); }}>
      <div className="caja">
        <div className="ch">{titulos[tipo]}</div>
        <div className="cb">
          <div className="prod">
            <div className="d">{f.descripcion}</div>
            <div className="c">{f.pdv_nombre} · {unidades(f.cantidad)} · vence {fechaCorta(f.fecha_vencimiento)}</div>
          </div>
          {error && <div className="err">{error}</div>}

          {tipo === 'proponer' && (<>
            <label className="campo"><span>Acción</span>
              <select value={tipoAccionId} onChange={e => setTipoAccionId(e.target.value)}>
                {d.acciones?.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select></label>
            <label className="campo"><span>Unidades a afectar (hay {f.cantidad})</span>
              <input type="number" inputMode="numeric" min="1" value={un}
                     onChange={e => setUn(e.target.value)} /></label>
            <div className={escalaKam ? 'warn' : 'nota'}>
              {f.unidades_por_caja
                ? escalaKam
                  ? `Son ${(Number(un) / f.unidades_por_caja).toFixed(2)} cajas y supera el límite de ${d.limiteCajas}. Lo tendrá que autorizar el KAM.`
                  : `Son ${(Number(un) / f.unidades_por_caja).toFixed(2)} cajas. Lo puede autorizar el supervisor.`
                : 'Este producto no tiene definidas sus unidades por caja, así que se escalará al KAM por precaución.'}
            </div>
          </>)}

          {tipo === 'autorizar' && (
            <div className="nota">
              {f.tipo_accion} por {unidades(f.cantidad_unidades)}
              {f.cantidad_cajas ? `, ${f.cantidad_cajas} cajas` : ''}. Propuesta por {f.propuesta_por}.
            </div>
          )}

          {tipo === 'escalar' && (
            <div className="warn">
              Son {f.cantidad_cajas ?? 'varias'} cajas y supera tu límite de {d.limiteCajas}.
              Se traslada al KAM para que lo autorice.
            </div>
          )}

          {tipo === 'rechazar' && (
            <label className="campo"><span>Motivo del rechazo</span>
              <input value={motivo} onChange={e => setMotivo(e.target.value)}
                     placeholder="Sin motivo no se puede rechazar" /></label>
          )}

          {tipo === 'ejecutar' && (<>
            <label className="campo"><span>Unidades que se movieron (de {f.cantidad_unidades})</span>
              <input type="number" inputMode="numeric" min="0" value={movidas}
                     onChange={e => setMovidas(e.target.value)} /></label>
            <label className="campo"><span>Número de vale, si la tienda lo extendió</span>
              <input value={vale} onChange={e => setVale(e.target.value)} placeholder="Opcional" /></label>
            <label className="campo"><span>Por qué llegó a estar próximo a vencer</span>
              <select value={causaId} onChange={e => setCausaId(e.target.value)}>
                {d.causas?.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select></label>
          </>)}
        </div>
        <div className="cf">
          <button className="btn ghost compacto" onClick={onCerrar}>Cancelar</button>
          <button className="btn compacto" disabled={enviando} onClick={enviar}>
            {enviando ? 'Guardando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
