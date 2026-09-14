'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

const UMBRAL = [
  { e: 'vivo', desde: 22, hasta: null, txt: 'Vivo' },
  { e: 'en_riesgo', desde: 8, hasta: 21, txt: 'En riesgo' },
  { e: 'critico', desde: 1, hasta: 7, txt: 'Crítico' },
  { e: 'vencido', desde: null, hasta: 0, txt: 'Vencido' },
];
const estadoDe = d => UMBRAL.find(u => (u.desde === null || d >= u.desde) && (u.hasta === null || d <= u.hasta)) ?? UMBRAL[3];
const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

export default function Captura({ usuario }) {
  const [pdv, setPdv] = useState(null);
  const [vista, setVista] = useState('tienda');
  const [prod, setProd] = useState(null);
  const [barra, setBarra] = useState(null);
  const [hoyLista, setHoyLista] = useState([]);
  const [aviso, setAviso] = useState('');

  const cargarHoy = useCallback(async (id) => {
    try {
      const r = await fetch(`/api/captura?pdv=${id}`);
      const d = await r.json();
      setHoyLista(d.filas ?? []);
    } catch { /* sin señal: la lista se queda como está */ }
  }, []);

  useEffect(() => { if (pdv) cargarHoy(pdv.id); }, [pdv, cargarHoy]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 1900);
    return () => clearTimeout(t);
  }, [aviso]);

  return (
    <div className="movil">
      <div className="bar">
        <div>
          <div className="who">{usuario.nombre} · {usuario.rol.replace('_', ' ')}</div>
          <div className="tienda">{pdv ? pdv.nombre : 'Sin tienda'}</div>
        </div>
        {pdv && <button onClick={() => { setPdv(null); setVista('tienda'); }}>Cambiar</button>}
      </div>

      <main>
        {vista === 'tienda' && <Tienda onElegir={p => { setPdv(p); setVista('escanear'); }} />}
        {vista === 'escanear' && (
          <Escanear
            onProducto={(p, b) => { setProd(p); setBarra(b); setVista('cantidad'); }}
            onBuscar={() => setVista('buscar')} />
        )}
        {vista === 'buscar' && (
          <Buscar
            onElegir={p => { setProd(p); setBarra(null); setVista('cantidad'); }}
            onVolver={() => setVista('escanear')} />
        )}
        {vista === 'cantidad' && (
          <Cantidad
            pdv={pdv} prod={prod} barra={barra} hoyLista={hoyLista}
            onListo={msg => { setAviso(msg); cargarHoy(pdv.id); setVista('escanear'); }}
            onCancelar={() => setVista('escanear')} />
        )}
        {vista === 'lista' && (
          <Lista filas={hoyLista} pdv={pdv} onVolver={() => setVista('escanear')} />
        )}
      </main>

      {pdv && vista === 'escanear' && (
        <div className="foot">
          <div>
            <div className="n">{hoyLista.length}</div>
            <div className="t">líneas en<br />esta tienda</div>
          </div>
          <button className="btn ghost" onClick={() => setVista('lista')}>Ver lo capturado</button>
        </div>
      )}
      {aviso && <div className="toast">{aviso}</div>}
    </div>
  );
}

function Tienda({ onElegir }) {
  const [q, setQ] = useState('');
  const [filas, setFilas] = useState([]);
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await fetch(`/api/buscar?tipo=pdv&q=${encodeURIComponent(q)}`);
      const d = await r.json();
      setFilas(d.filas ?? []);
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  return (<>
    <div>
      <h1>¿En qué tienda estás?</h1>
      <p className="sub">Se elige de la lista. Nunca se escribe, y así no se repiten nombres distintos para la misma tienda.</p>
    </div>
    <input type="search" placeholder="Buscar tienda" value={q}
           onChange={e => setQ(e.target.value)} autoComplete="off" />
    <div className="list">
      {filas.length ? filas.map(p => (
        <button key={p.id} className="row" onClick={() => onElegir(p)}>
          <div>
            <div className="nm">{p.nombre}</div>
            <div className="mt">{p.cadena_grupo ?? 'sin cadena'} · {p.codigo}</div>
          </div>
        </button>
      )) : <div className="vacio">No hay tiendas con ese nombre.</div>}
    </div>
  </>);
}

function Escanear({ onProducto, onBuscar }) {
  const v = useRef(null);
  const [hint, setHint] = useState('Pidiendo permiso de cámara…');
  const [manual, setManual] = useState(false);
  const [cod, setCod] = useState('');
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    let stream = null;
    const sinCamara = m => { setHint(m); setManual(true); };

    (async () => {
      if (!window.isSecureContext) return sinCamara('La cámara necesita una dirección https. Escribe el código o busca por nombre.');
      if (!navigator.mediaDevices?.getUserMedia) return sinCamara('Este navegador no da acceso a la cámara.');
      if (!('BarcodeDetector' in window)) return sinCamara('Este navegador no lee códigos de barras. Escribe el código o busca por nombre.');
      try {
        const det = new window.BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e','code_128','itf'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!vivo.current) { stream.getTracks().forEach(t => t.stop()); return; }
        v.current.srcObject = stream;
        await v.current.play();
        setHint('Buscando código…');
        const leer = async () => {
          if (!vivo.current) return;
          try {
            const c = await det.detect(v.current);
            if (c.length) { resolver(c[0].rawValue); return; }
          } catch {}
          requestAnimationFrame(leer);
        };
        leer();
      } catch (err) {
        sinCamara(err?.name === 'NotAllowedError'
          ? 'Diste permiso denegado a la cámara. Cámbialo en el candado de la barra de direcciones.'
          : 'No se pudo abrir la cámara. Escribe el código o busca por nombre.');
      }
    })();

    return () => { vivo.current = false; if (stream) stream.getTracks().forEach(t => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resolver(raw) {
    vivo.current = false;
    try {
      const r = await fetch(`/api/buscar?tipo=barra&q=${encodeURIComponent(raw)}`);
      const d = await r.json();
      // Si el codigo no esta en el catalogo, se sigue igual: la captura no se pierde
      onProducto(d.fila ?? null, raw);
    } catch {
      onProducto(null, raw);
    }
  }

  return (<>
    <div>
      <h1>Escanea el producto</h1>
      <p className="sub">Apunta la cámara al código de barras del empaque.</p>
    </div>
    {!manual && <video className="cam" ref={v} playsInline muted />}
    <div className="hint">{hint}</div>
    {manual && (<>
      <div>
        <label className="lbl" htmlFor="cm">Escribe el código del empaque</label>
        <input id="cm" type="text" inputMode="numeric" value={cod}
               onChange={e => setCod(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (cod.trim()) resolver(cod.trim()); } }}
               placeholder="Ej: 7401005904011" autoComplete="off" />
      </div>
      <button className="btn sm" disabled={!cod.trim()} onClick={() => resolver(cod.trim())}>
        Usar este código
      </button>
    </>)}
    <button className="btn ghost sm" onClick={onBuscar}>Buscar por nombre</button>
  </>);
}

function Buscar({ onElegir, onVolver }) {
  const [q, setQ] = useState('');
  const [filas, setFilas] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setFilas([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/buscar?tipo=producto&q=${encodeURIComponent(q)}`);
      const d = await r.json();
      setFilas(d.filas ?? []);
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  return (<>
    <div><h1>Buscar producto</h1><p className="sub">Escribe parte del nombre o el código.</p></div>
    <input type="search" placeholder="Ej: gatorlyte, pepsi 355" value={q}
           onChange={e => setQ(e.target.value)} autoComplete="off" />
    <div className="list">
      {filas.length ? filas.map(p => (
        <button key={p.id} className="row" onClick={() => onElegir(p)}>
          <div>
            <div className="nm">{p.descripcion}</div>
            <div className="mt">{p.codigo_sap} · {p.unidades_por_caja ? `${p.unidades_por_caja} por caja` : 'caja sin definir'}</div>
          </div>
        </button>
      )) : <div className="vacio">{q.trim().length < 2 ? 'Escribe al menos dos letras.' : 'Ningún producto coincide.'}</div>}
    </div>
    <button className="btn ghost sm" onClick={onVolver}>Volver a escanear</button>
  </>);
}

function Cantidad({ pdv, prod, barra, hoyLista, onListo, onCancelar }) {
  const hoy = new Date();
  const [cant, setCant] = useState('');
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [confirmar, setConfirmar] = useState(null);

  // Si ese producto ya se capturó en esta tienda, se actualiza la cantidad
  const previa = prod ? hoyLista.find(f => f.descripcion === prod.descripcion) : null;
  const fecha = previa
    ? previa.fecha_vencimiento.slice(0, 10)
    : `${anio}-${String(mes).padStart(2, '0')}-${new Date(anio, mes, 0).getDate()}`;
  const dias = Math.round((new Date(fecha + 'T00:00:00') - new Date(hoy.toDateString())) / 86400000);
  const u = estadoDe(dias);

  async function guardar(confirmaAumento = false) {
    setError('');
    const n = parseInt(cant, 10);
    if (!Number.isInteger(n) || n < 1) return setError('Escribe la cantidad antes de guardar.');
    setGuardando(true);
    try {
      const r = await fetch('/api/captura', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdvId: pdv.id, productoId: prod?.id ?? null, barra,
          cantidad: n, vencimiento: fecha, confirmaAumento,
        }),
      });
      const d = await r.json();
      if (d.requiereConfirmacion) { setConfirmar(d.anterior); return; }
      if (!r.ok) { setError(d.error ?? 'No se pudo guardar.'); return; }
      onListo(d.actualizado ? `Actualizado: ${n} unidades` : 'Guardado');
    } catch {
      setError('Sin señal. Acércate a donde haya cobertura e intenta de nuevo.');
    } finally { setGuardando(false); }
  }

  if (confirmar !== null) return (<>
    <div className="warn">
      Antes había <b>{confirmar}</b> y ahora pusiste <b>{cant}</b>. ¿Llegó producto nuevo del mismo lote?
    </div>
    <button className="btn" onClick={() => { setConfirmar(null); guardar(true); }}>Sí, es producto nuevo</button>
    <button className="btn ghost sm" onClick={() => setConfirmar(null)}>No, corregir la cantidad</button>
  </>);

  return (<>
    {prod ? (
      <div className="prod">
        <div className="d">{prod.descripcion}</div>
        <div className="c">
          {prod.codigo_sap}{barra ? ` · ${barra}` : ''}
          {prod.unidades_por_caja ? ` · ${prod.unidades_por_caja} por caja` : ''}
        </div>
      </div>
    ) : (
      <div className="warn">
        Este código no está en el catálogo. Se guarda igual y queda marcado para revisar.
        <div className="c">{barra}</div>
      </div>
    )}

    {previa && (
      <div className="prev">
        <span>La última vez había</span>
        <b>{previa.cantidad}</b>
        <span>¿Cuántas hay hoy?</span>
      </div>
    )}

    {error && <div className="err">{error}</div>}

    <div>
      <label className="lbl" htmlFor="ct">{previa ? 'Cantidad de hoy' : 'Cantidad en unidades'}</label>
      <input id="ct" className="grande" type="number" inputMode="numeric" min="1"
             value={cant} onChange={e => setCant(e.target.value)} placeholder="0" autoFocus />
    </div>

    {!previa && (<>
      <div>
        <span className="lbl">Vence en</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
          <select value={mes} onChange={e => setMes(+e.target.value)}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={anio} onChange={e => setAnio(+e.target.value)}>
            {[hoy.getFullYear(), hoy.getFullYear() + 1, hoy.getFullYear() + 2].map(a =>
              <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
      <div><span className={`pill p-${u.e}`}>{u.txt} · {dias} días</span></div>
    </>)}

    <button className="btn" disabled={guardando} onClick={() => guardar(false)}>
      {guardando ? 'Guardando…' : 'Guardar y seguir'}
    </button>
    <button className="btn ghost sm" onClick={onCancelar}>Cancelar</button>
  </>);
}

function Lista({ filas, pdv, onVolver }) {
  return (<>
    <div><h1>Capturado en esta tienda</h1><p className="sub">{pdv.nombre}</p></div>
    <div className="list">
      {filas.length ? filas.map(f => (
        <div key={f.id} className="row" style={{ cursor: 'default' }}>
          <div style={{ flex: 1 }}>
            <div className="nm">{f.descripcion ?? 'Sin catálogo'}</div>
            <div className="mt">{f.cantidad} unidades · vence {f.fecha_vencimiento.slice(0, 10)}</div>
          </div>
          <span className={`pill p-${f.estado ?? 'vencido'}`}>{f.dias_restantes} d</span>
        </div>
      )) : <div className="vacio">Todavía no hay nada capturado aquí.</div>}
    </div>
    <button className="btn" onClick={onVolver}>Seguir capturando</button>
  </>);
}
