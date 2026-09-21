'use client';
import { useCallback, useEffect, useState } from 'react';

const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const fechaCorta = iso => {
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${Number(d)} ${MESES[Number(m) - 1]} ${a}`;
};
const unidades = n => `${n} ${Number(n) === 1 ? 'unidad' : 'unidades'}`;
const TXT = { vivo:'Vivo', en_riesgo:'En riesgo', critico:'Crítico', vencido:'Vencido' };

// Cada rol entra directo a su bandeja. Ver pestañas que no le tocan solo estorba.
// El supervisor jr propone y no autoriza: su bandeja no incluye revisiones.
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
    if (!r.ok) return { error: j.error ?? 'No se pudo completar.', datos: j };
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
          <div className="tienda">Casos</div>
          <div className="who">{usuario.nombre} · {usuario.rol.replace('_', ' ')}</div>
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
        {d?.error && <div className="err" role="alert">{d.error}</div>}
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

        {!cargando && d?.filas?.length > 0 && (
          <div className="list">
            {d.filas.map(f => (
              <Caso key={f.caso_id} f={f} rol={usuario.rol} veDinero={d.veDinero}
                    onAccion={(tipo) => setModal({ tipo, f })} />
            ))}
          </div>
        )}
      </main>

      {modal && (
        <Modal m={modal} d={d} onCerrar={() => setModal(null)}
               onReabrir={(tipo, f) => setModal({ tipo, f })}
               onEnviar={async (metodo, cuerpo) => {
                 const r = await enviar(metodo, cuerpo);
                 if (r.error) return r;
                 setModal(null);
                 setAviso(r.perdida ? 'Registrado como pérdida'
                   : r.kamNombre ? `Pasó a ${r.kamNombre}` : 'Listo');
                 cargar();
                 return null;
               }} />
      )}
      {aviso && <div className="toast" role="status">{aviso}</div>}
    </div>
  );
}

// En el teléfono es una tarjeta con una sola acción principal. Tres botones de
// 14px alineados a la derecha era una trampa para el pulgar, y los usuarios
// principales de esta pantalla son supervisores que están en el pasillo.
function Caso({ f, rol, veDinero, onAccion }) {
  const superaLimite = f.nivel_requerido === 'kam';
  const [abierto, setAbierto] = useState(false);

  const acciones = [];
  if (!f.accion_id && ['supervisor_jr', 'supervisor', 'administrador'].includes(rol))
    acciones.push(['proponer', 'Proponer acción', true]);
  if (f.estado_accion === 'en_revision_supervisor' && ['supervisor', 'administrador'].includes(rol))
    acciones.push(superaLimite ? ['escalar', 'Trasladar al KAM', true] : ['autorizar', 'Autorizar', true]);
  if (f.estado_accion === 'en_revision_kam' && ['kam', 'administrador'].includes(rol))
    acciones.push(['autorizar', 'Autorizar', true]);
  if (['en_revision_supervisor', 'en_revision_kam'].includes(f.estado_accion)
      && ['supervisor', 'kam', 'administrador'].includes(rol))
    acciones.push(['rechazar', 'Rechazar', false]);
  if (f.estado_accion === 'autorizada')
    acciones.push(['ejecutar', 'Marcar hecho', true]);

  const principal = acciones.find(a => a[2]) ?? acciones[0];
  const otras = acciones.filter(a => a !== principal);

  return (
    <div className="fila caso">
      <div className="info">
        <div className="cab">
          <span className={`pill p-${f.estado}`}>{TXT[f.estado] ?? f.estado} · {f.dias_restantes} d</span>
          <span className="mt" style={{ marginTop: 0 }}>
            {unidades(f.cantidad)}{f.cajas ? ` · ${f.cajas} cajas` : ' · caja sin definir'}
          </span>
        </div>
        <div className="nm">{f.descripcion ?? 'Sin catálogo'}</div>
        <div className="mt">
          {f.pdv_nombre} · vence {fechaCorta(f.fecha_vencimiento)}
          {f.fecha_precision === 'mes' ? ' (día exacto desconocido)' : ''}
          {veDinero && f.valor_en_riesgo ? ` · Q ${Number(f.valor_en_riesgo).toLocaleString('es-GT')}` : ''}
        </div>

        {f.por_clasificar && (
          <div className="warn" style={{ marginTop: 8 }}>
            Tienda sin clasificar: el sistema no sabe a qué KAM pertenece.
          </div>
        )}

        {f.accion_id && (
          <div className="hist">
            {f.tipo_accion} por {unidades(f.cantidad_unidades)}
            {f.cantidad_cajas ? ` (${f.cantidad_cajas} cajas)` : ''}
            {f.propuesta_por ? ` · propuso ${f.propuesta_por}` : ''}
            {f.autorizada_por ? ` · autorizó ${f.autorizada_por}` : ''}
          </div>
        )}

        {f.estado_accion === 'en_revision_kam' && !['kam', 'administrador'].includes(rol) && (
          <div className="ruteo" style={{ marginTop: 8 }}>
            Con {f.kam_nombre ?? 'el KAM'}, esperando autorización
          </div>
        )}
        {f.estado_accion === 'en_revision_supervisor' && !['supervisor', 'administrador'].includes(rol) && (
          <div className="ruteo" style={{ marginTop: 8 }}>
            Con {f.supervisor_nombre ?? 'el supervisor'}, esperando revisión
          </div>
        )}
      </div>

      {acciones.length > 0 && (
        <div className="acc">
          <button className={`btn compacto${principal[2] ? '' : ' ghost'}`}
                  onClick={() => onAccion(principal[0])}>{principal[1]}</button>
          {otras.length > 0 && (
            <button className="mas" aria-label="Más acciones"
                    onClick={() => setAbierto(v => !v)}>···</button>
          )}
        </div>
      )}
      {abierto && otras.map(([k, t]) => (
        <button key={k} className="btn ghost sm" style={{ marginTop: 8 }}
                onClick={() => { setAbierto(false); onAccion(k); }}>{t}</button>
      ))}
    </div>
  );
}

function Modal({ m, d, onCerrar, onEnviar, onReabrir }) {
  const { tipo, f } = m;
  const [tipoAccionId, setTipoAccionId] = useState(d.acciones?.[1]?.id ?? d.acciones?.[0]?.id ?? '');
  const [un, setUn] = useState(String(f.cantidad ?? ''));
  const [upc, setUpc] = useState(String(f.upc_sugerido ?? ''));
  const [motivo, setMotivo] = useState('');
  const [movidas, setMovidas] = useState(String(f.cantidad_unidades ?? ''));
  const [vale, setVale] = useState('');
  const [causaId, setCausaId] = useState(d.causas?.[1]?.id ?? '');
  const [cadena, setCadena] = useState(f.cadena_grupo ?? '');
  const [region, setRegion] = useState(f.region ?? '');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  // La pregunta de unidades por caja solo aparece cuando falta el dato, y
  // siempre con su respaldo a la vista. La inferencia automática falla 35% en
  // lata de 355 ml, que es el formato más común: por eso la confirma un humano.
  const preguntaUpc = tipo === 'proponer' && f.upc_pendiente;
  const upcEfectivo = preguntaUpc ? Number(upc) : f.unidades_por_caja;
  const cajas = upcEfectivo ? (Number(un) / upcEfectivo) : null;
  const escalaKam = cajas === null || !Number.isFinite(cajas) || cajas > d.limiteCajas;
  const limiteUn = upcEfectivo ? upcEfectivo * d.limiteCajas : null;

  const titulos = {
    proponer: 'Proponer acción', autorizar: 'Autorizar', escalar: 'Trasladar al KAM',
    rechazar: 'Rechazar', ejecutar: 'Confirmar ejecución', clasificar: 'Clasificar la tienda',
  };

  async function enviar() {
    setError(''); setEnviando(true);
    let r = null;
    if (tipo === 'proponer')
      r = await onEnviar('POST', { casoId: f.caso_id, tipoAccionId, unidades: Number(un),
        unidadesPorCaja: preguntaUpc ? Number(upc) : null });
    else if (tipo === 'clasificar')
      r = await onEnviar('PATCH', { accion: 'clasificar', puntoVentaId: f.punto_venta_id,
        cadenaGrupo: cadena, region });
    else if (tipo === 'ejecutar')
      r = await onEnviar('PATCH', { accionId: f.accion_id, accion: 'ejecutar',
        movidas: Number(movidas), numeroVale: vale, causaId });
    else if (tipo === 'rechazar')
      r = await onEnviar('PATCH', { accionId: f.accion_id, accion: 'rechazar', motivo });
    else
      r = await onEnviar('PATCH', { accionId: f.accion_id, accion: tipo });

    if (r?.error) {
      // El traslado a una tienda sin cadena no se queda atorado: manda a
      // corregir el dato que falta y regresa al mismo caso.
      if (r.datos?.requiereClasificar) { onReabrir('clasificar', f); return; }
      setError(r.error);
    }
    setEnviando(false);
  }

  return (
    <div className="modal" onClick={e => { if (e.target.className === 'modal') onCerrar(); }}>
      <div className="caja" role="dialog" aria-label={titulos[tipo]}>
        <div className="ch">{titulos[tipo]}</div>
        <div className="cb">
          <div className="prod">
            <div className="d">{f.descripcion}</div>
            <div className="c">{f.pdv_nombre} · {unidades(f.cantidad)} · vence {fechaCorta(f.fecha_vencimiento)}</div>
          </div>
          {error && <div className="err" role="alert">{error}</div>}

          {tipo === 'clasificar' && (<>
            <div className="nota">
              Al guardar, el sistema asigna solo el KAM y el supervisor de esta tienda.
              No hay que elegirlos.
            </div>
            <label className="campo"><span>Cadena</span>
              <select value={cadena} onChange={e => setCadena(e.target.value)}>
                <option value="">Elegir…</option>
                {d.cadenas?.map(c => <option key={c} value={c}>{c}</option>)}
              </select></label>
            <label className="campo"><span>Región</span>
              <select value={region} onChange={e => setRegion(e.target.value)}>
                <option value="">Elegir…</option>
                {d.regiones?.map(r => <option key={r} value={r}>{r}</option>)}
              </select></label>
          </>)}

          {tipo === 'proponer' && (<>
            <label className="campo"><span>Acción</span>
              <select value={tipoAccionId} onChange={e => setTipoAccionId(e.target.value)}>
                {d.acciones?.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select></label>

            {preguntaUpc && (
              <label className="campo"><span>¿Cuántas unidades trae la caja?</span>
                <input type="number" inputMode="numeric" min="1" max="999" value={upc}
                       onChange={e => setUpc(e.target.value)} />
                <span>
                  {f.upc_sugerido
                    ? `Sugerido ${f.upc_sugerido} — así vienen ${f.upc_coincidencias} de ${f.upc_muestra} ${f.upc_envase ?? ''} de ${f.upc_tamano ?? ''}`.trim()
                    : 'No hay productos parecidos para sugerir un número. Cuéntalo en la caja.'}
                </span>
              </label>
            )}

            <label className="campo"><span>Unidades a afectar (hay {f.cantidad})</span>
              <input type="number" inputMode="numeric" min="1" value={un}
                     onChange={e => setUn(e.target.value)} /></label>

            <div className={escalaKam ? 'warn' : 'nota'}>
              {upcEfectivo
                ? escalaKam
                  ? `Son ${un} unidades. El límite del supervisor en este producto son ${d.limiteCajas} cajas = ${limiteUn} unidades, así que lo autoriza el KAM.`
                  : `Son ${un} unidades = ${cajas.toFixed(2)} cajas. Dentro del límite de ${limiteUn} unidades: lo autoriza el supervisor.`
                : 'Sin las unidades por caja el sistema no puede medir el límite, así que escala al KAM por precaución.'}
            </div>
          </>)}

          {tipo === 'autorizar' && (<>
            <div className="nota">
              {f.tipo_accion} por {unidades(f.cantidad_unidades)}
              {f.cantidad_cajas ? `, ${f.cantidad_cajas} cajas` : ''}. Propuesta por {f.propuesta_por}.
            </div>
            {!f.foto_evidencia_url && (
              <div className="warn">Esta detección no trae foto del código de fecha.</div>
            )}
          </>)}

          {tipo === 'escalar' && (<>
            <div className="warn">
              Son {f.cantidad_cajas ?? 'varias'} cajas y supera tu límite de {d.limiteCajas}.
            </div>
            <div className="ruteo">
              {f.kam_nombre
                ? `Pasa a ${f.kam_nombre}${f.cadena_grupo ? ` (${f.cadena_grupo})` : ''}`
                : 'Esta tienda no tiene cadena asignada. Al confirmar te pediré clasificarla para saber a qué KAM pasa.'}
            </div>
          </>)}

          {tipo === 'rechazar' && (
            <label className="campo"><span>Motivo del rechazo (obligatorio)</span>
              <input value={motivo} onChange={e => setMotivo(e.target.value)}
                     aria-invalid={error && !motivo.trim() ? 'true' : undefined}
                     placeholder="Ej: mejor trasladarlo a Mixco" /></label>
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
