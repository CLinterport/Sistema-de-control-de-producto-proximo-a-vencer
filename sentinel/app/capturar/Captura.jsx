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
// "31 ago 2027" se lee de un vistazo; "2027-08-31" hay que descifrarlo.
const fechaCorta = (iso, precision) => {
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return precision === 'mes' ? `${MESES[Number(m) - 1]} ${a}` : `${Number(d)} ${MESES[Number(m) - 1]} ${a}`;
};
const unidades = n => `${n} ${Number(n) === 1 ? 'unidad' : 'unidades'}`;
const RECORDADA = 'sentinel.tienda';

function leerRecordada() {
  try { return JSON.parse(localStorage.getItem(RECORDADA) ?? 'null'); } catch { return null; }
}
function guardarRecordada(p) {
  try { localStorage.setItem(RECORDADA, JSON.stringify(p)); } catch { /* modo privado */ }
}

export default function Captura({ usuario }) {
  const [pdv, setPdv] = useState(null);
  const [vista, setVista] = useState('tienda');
  const [prod, setProd] = useState(null);
  const [barra, setBarra] = useState(null);
  const [hoyLista, setHoyLista] = useState([]);
  const [meta, setMeta] = useState({});
  const [aviso, setAviso] = useState('');

  // La camara se pide una sola vez y el flujo la conserva entre lineas. Antes
  // se desmontaba al pasar a la cantidad y volvia a pedir permiso al regresar:
  // uno o dos segundos por linea sobre un presupuesto de quince.
  const camara = useRef(null);
  const pedirCamara = useCallback(async () => {
    if (camara.current) return camara.current;
    camara.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    return camara.current;
  }, []);
  useEffect(() => () => { camara.current?.getTracks().forEach(t => t.stop()); }, []);

  const cargarHoy = useCallback(async (id) => {
    try {
      const r = await fetch(`/api/captura?pdv=${id}`);
      const d = await r.json();
      setHoyLista(d.filas ?? []);
      setMeta({ tienda: d.tienda, regionPropuesta: d.regionPropuesta, regiones: d.regiones ?? [] });
      if (d.tienda) setPdv(p => (p && p.id === d.tienda.id ? { ...p, ...d.tienda } : p));
    } catch { /* sin señal: la lista se queda como está */ }
  }, []);

  useEffect(() => { if (pdv) cargarHoy(pdv.id); }, [pdv?.id, cargarHoy]); // eslint-disable-line
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 1900);
    return () => clearTimeout(t);
  }, [aviso]);

  function elegir(p) { guardarRecordada(p); setPdv(p); setVista('escanear'); }

  function atras() {
    if (vista === 'tienda') { window.location.href = '/inicio'; return; }
    if (vista === 'escanear') { setPdv(null); setVista('tienda'); return; }
    setVista('escanear');
  }

  return (
    <div className="movil">
      <div className="bar">
        <button className="atras" onClick={atras} aria-label="Regresar">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
               stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div>
          <div className="tienda">{pdv ? pdv.nombre : 'Elegir tienda'}</div>
          <div className="who">{usuario.nombre} · {usuario.rol.replace('_', ' ')}</div>
        </div>
        {pdv && <button onClick={() => { setPdv(null); setVista('tienda'); }}>Cambiar</button>}
      </div>

      <main>
        {vista === 'tienda' && <Tienda onElegir={elegir} />}
        {vista === 'escanear' && (
          <Escanear
            pedirCamara={pedirCamara}
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
            pdv={pdv} prod={prod} barra={barra} hoyLista={hoyLista} meta={meta}
            onListo={msg => { setAviso(msg); cargarHoy(pdv.id); setVista('escanear'); }}
            onCancelar={() => setVista('escanear')} />
        )}
        {vista === 'lista' && (
          <Lista filas={hoyLista} pdv={pdv} onVolver={() => setVista('escanear')} />
        )}
      </main>

      {pdv && (vista === 'escanear' || vista === 'buscar') && (
        <div className="foot">
          <div>
            <div className="n">{hoyLista.length}</div>
            <div className="t">líneas en<br />esta tienda</div>
          </div>
          <button className="btn ghost" onClick={() => setVista('lista')}>Ver lo capturado</button>
        </div>
      )}
      {aviso && <div className="toast" role="status">{aviso}</div>}
    </div>
  );
}

function Tienda({ onElegir }) {
  const [q, setQ] = useState('');
  const [filas, setFilas] = useState([]);
  const [recordada, setRecordada] = useState(null);

  useEffect(() => { setRecordada(leerRecordada()); }, []);
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await fetch(`/api/buscar?tipo=pdv&q=${encodeURIComponent(q)}`);
      const d = await r.json();
      setFilas(d.filas ?? []);
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  // Casi siempre se capturan varias lineas seguidas en la misma tienda. Empezar
  // por preguntar si sigue ahi ahorra tres toques por visita.
  if (recordada && !q) return (<>
    <div>
      <h1>¿Sigues en esta tienda?</h1>
      <p className="sub">La última donde capturaste.</p>
    </div>
    <div className="prod">
      <div className="d">{recordada.nombre}</div>
      <div className="c">{recordada.cadena_grupo ?? 'sin cadena'} · {recordada.codigo}</div>
    </div>
    <button className="btn" onClick={() => onElegir(recordada)}>Sí, seguir aquí</button>
    <button className="btn ghost sm" onClick={() => setRecordada(null)}>Estoy en otra tienda</button>
  </>);

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
            <div className="mt">
              {p.cadena_grupo ?? 'sin cadena'} · {p.codigo}
              {p.reciente ? ' · ya capturaste aquí' : ''}
            </div>
          </div>
        </button>
      )) : <div className="vacio">
        {q ? 'No hay tiendas con ese nombre.' : 'Escribe el nombre de la tienda para buscarla.'}
      </div>}
    </div>
  </>);
}

function Escanear({ onProducto, onBuscar, pedirCamara }) {
  const v = useRef(null);
  const [hint, setHint] = useState('Pidiendo permiso de cámara…');
  const [manual, setManual] = useState(false);
  const [cod, setCod] = useState('');
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    const sinCamara = m => { setHint(m); setManual(true); };

    (async () => {
      if (!window.isSecureContext) return sinCamara('La cámara necesita una dirección https. Escribe el código o busca por nombre.');
      if (!navigator.mediaDevices?.getUserMedia) return sinCamara('Este navegador no da acceso a la cámara.');
      if (!('BarcodeDetector' in window)) return sinCamara('Este navegador no lee códigos de barras. Escribe el código o busca por nombre.');
      try {
        const det = new window.BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e','code_128','itf'] });
        const stream = await pedirCamara();
        if (!vivo.current) return;
        v.current.srcObject = stream;
        await v.current.play();
        setHint('Buscando código…');
        // Ocho lecturas por segundo alcanzan de sobra. A sesenta el telefono
        // se calienta y la bateria no llega al final de la ruta.
        const leer = async () => {
          if (!vivo.current) return;
          try {
            const c = await det.detect(v.current);
            if (c.length) { resolver(c[0].rawValue); return; }
          } catch {}
          setTimeout(leer, 120);
        };
        leer();
      } catch (err) {
        sinCamara(err?.name === 'NotAllowedError'
          ? 'Diste permiso denegado a la cámara. Cámbialo en el candado de la barra de direcciones.'
          : 'No se pudo abrir la cámara. Escribe el código o busca por nombre.');
      }
    })();

    // La camara no se apaga aqui: vive en el componente de arriba para no
    // volver a pedirla en cada linea.
    return () => { vivo.current = false; };
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

// La foto sale de la camara del sistema, no del video que ya esta abierto para
// escanear: la camara nativa enfoca de cerca y un codigo de fecha impreso en
// tinta clara necesita ese enfoque. Se reduce a 1000px de ancho y calidad 0.6,
// que deja unos 60 KB: suficiente para leer la fecha, poco para una red movil.
function comprimir(archivo) {
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onerror = () => mal(new Error('No se pudo leer la foto.'));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => mal(new Error('No se pudo abrir la foto.'));
      img.onload = () => {
        const escala = Math.min(1, 1000 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * escala);
        c.height = Math.round(img.height * escala);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL('image/jpeg', 0.6));
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(archivo);
  });
}

function Cantidad({ pdv, prod, barra, hoyLista, meta, onListo, onCancelar }) {
  const hoy = new Date();
  const upc = prod?.unidades_por_caja ?? null;

  // Arranca en cajas si el producto se vende por caja y se sabe cuantas trae.
  // La bodega mueve cajas; C-Store mueve unidades sueltas. Los dos son reales.
  const [modo, setModo] = useState(prod?.medida === 'CJ' && upc ? 'cajas' : 'unidades');
  const [cant, setCant] = useState('');
  const [dia, setDia] = useState('');
  const [mes, setMes] = useState('');
  const [anio, setAnio] = useState('');
  const [precision, setPrecision] = useState('dia');
  const [region, setRegion] = useState(meta.regionPropuesta ?? '');
  const [foto, setFoto] = useState(null);
  const [error, setError] = useState('');
  const [campoMalo, setCampoMalo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [confirmar, setConfirmar] = useState(null);
  const refMes = useRef(null), refAnio = useRef(null), refCant = useRef(null);

  const previa = prod ? hoyLista.find(f => f.descripcion === prod.descripcion) : null;

  // Las unidades son la moneda del sistema. Las cajas son solo una forma de
  // teclear menos: la API recibe y guarda siempre unidades.
  const enUnidades = modo === 'cajas' && upc ? Math.round(Number(cant || 0) * upc) : Number(cant || 0);

  const mesN = Number(mes), anioN = anio.length === 2 ? 2000 + Number(anio) : Number(anio);
  const diaN = precision === 'mes' ? 1 : Number(dia);
  const fechaOk = previa || (mesN >= 1 && mesN <= 12 && anioN >= hoy.getFullYear() - 1
    && anioN <= hoy.getFullYear() + 3 && diaN >= 1 && diaN <= 31);
  const fecha = previa
    ? previa.fecha_vencimiento.slice(0, 10)
    : fechaOk ? `${anioN}-${String(mesN).padStart(2, '0')}-${String(diaN).padStart(2, '0')}` : null;
  // Con precision de mes el riesgo se mide contra el dia 1: pesimista a proposito.
  const dias = fecha
    ? Math.round((new Date(fecha + 'T00:00:00') - new Date(hoy.toDateString())) / 86400000)
    : null;
  const u = dias === null ? null : estadoDe(dias);

  // Los lotes se repiten en un mismo anaquel. Reusar una fecha ya capturada hoy
  // en esta tienda quita tres toques.
  const fechasHoy = [...new Map(hoyLista.filter(f => f.fecha_vencimiento)
    .map(f => [f.fecha_vencimiento.slice(0, 10), f])).values()].slice(0, 3);

  function ponerFecha(iso, prec) {
    const [a, m, d] = iso.split('-');
    setAnio(a.slice(2)); setMes(String(Number(m))); setDia(String(Number(d)));
    setPrecision(prec ?? 'dia');
  }

  async function guardar(confirmaAumento = false) {
    setError(''); setCampoMalo('');
    if (!Number.isInteger(enUnidades) || enUnidades < 1) {
      setCampoMalo('cantidad');
      return setError('Escribe la cantidad antes de guardar.');
    }
    if (!fecha) {
      setCampoMalo('fecha');
      return setError('Revisa la fecha de vencimiento.');
    }
    setGuardando(true);
    try {
      const r = await fetch('/api/captura', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdvId: pdv.id, productoId: prod?.id ?? null, barra,
          cantidad: enUnidades, vencimiento: fecha, fechaPrecision: precision,
          region: pdv.region ? null : (region || null), confirmaAumento, foto,
        }),
      });
      const d = await r.json();
      if (d.requiereConfirmacion) { setConfirmar(d.anterior); return; }
      if (!r.ok) { setError(d.error ?? 'No se pudo guardar.'); return; }
      onListo(d.actualizado ? `Actualizado: ${unidades(enUnidades)}` : 'Guardado');
    } catch {
      setError('Sin señal. Acércate a donde haya cobertura e intenta de nuevo.');
    } finally { setGuardando(false); }
  }

  if (confirmar !== null) return (<>
    <div className="warn">
      Antes había <b>{confirmar}</b> y ahora pusiste <b>{enUnidades}</b>. ¿Llegó producto nuevo del mismo lote?
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
          {upc ? ` · ${upc} por caja` : ' · caja sin definir'}
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
        <span>¿Cuántas hay hoy? · vence {fechaCorta(previa.fecha_vencimiento, previa.fecha_precision)}</span>
      </div>
    )}

    {error && <div className="err" role="alert">{error}</div>}

    <div className="seg" role="group" aria-label="Contar en unidades o en cajas">
      <button className={modo === 'unidades' ? 'on' : ''} onClick={() => setModo('unidades')}>Unidades</button>
      <button className={modo === 'cajas' ? 'on' : ''} disabled={!upc}
              onClick={() => upc && setModo('cajas')}>Cajas</button>
    </div>
    {!upc && <div className="hint">Falta el dato de cuántas unidades trae la caja.</div>}

    <div>
      <label className="lbl" htmlFor="ct">
        {previa ? 'Cantidad de hoy' : 'Cuántas hay'} en {modo}
      </label>
      <input id="ct" ref={refCant} className="grande" type="number" inputMode="numeric" min="1"
             value={cant} onChange={e => setCant(e.target.value)} autoFocus
             aria-invalid={campoMalo === 'cantidad' ? 'true' : undefined}
             enterKeyHint={previa ? 'done' : 'next'}
             onKeyDown={e => {
               if (e.key !== 'Enter') return;
               e.preventDefault();
               if (previa) { guardar(false); return; }
               e.target.blur();
             }} />
      {modo === 'cajas' && upc && (
        <div className="conv">{cant || 0} cajas = {enUnidades} unidades</div>
      )}
    </div>

    {!previa && (<>
      <div>
        <span className="lbl">Vence</span>
        {precision === 'dia' ? (
          <div className="fecha3">
            <input inputMode="numeric" maxLength={2} placeholder="dd" value={dia}
                   aria-label="Día" aria-invalid={campoMalo === 'fecha' ? 'true' : undefined}
                   onChange={e => {
                     const v = e.target.value.replace(/\D/g, '').slice(0, 2);
                     setDia(v);
                     if (v.length === 2) refMes.current?.focus();
                   }} />
            <input ref={refMes} inputMode="numeric" maxLength={2} placeholder="mm" value={mes}
                   aria-label="Mes"
                   onChange={e => {
                     const v = e.target.value.replace(/\D/g, '').slice(0, 2);
                     setMes(v);
                     if (v.length === 2) refAnio.current?.focus();
                   }} />
            <input ref={refAnio} inputMode="numeric" maxLength={2} placeholder="aa" value={anio}
                   aria-label="Año"
                   onChange={e => setAnio(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </div>
        ) : (
          <div className="fecha3" style={{ gridTemplateColumns: '2fr 1fr' }}>
            <select value={mes} onChange={e => setMes(e.target.value)} aria-label="Mes">
              <option value="">mes</option>
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <input inputMode="numeric" maxLength={2} placeholder="aa" value={anio}
                   aria-label="Año"
                   onChange={e => setAnio(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </div>
        )}
        <button className="enlace" onClick={() => setPrecision(p => p === 'dia' ? 'mes' : 'dia')}>
          {precision === 'dia' ? 'El empaque solo dice mes y año' : 'Sí trae el día exacto'}
        </button>
      </div>

      {fechasHoy.length > 0 && !dia && !mes && (
        <div className="chips">
          {fechasHoy.map(f => (
            <button key={f.fecha_vencimiento} className="chip"
                    onClick={() => ponerFecha(f.fecha_vencimiento.slice(0, 10), f.fecha_precision)}>
              {fechaCorta(f.fecha_vencimiento, f.fecha_precision)}
            </button>
          ))}
        </div>
      )}

      {u && (
        <div className={`estado e-${u.e}${precision === 'mes' ? ' aprox' : ''}`}>
          <div className="e">{u.txt} · {dias} días</div>
          <div className="x">
            vence {fechaCorta(fecha, precision)}
            {precision === 'mes' ? ' · día exacto desconocido, se mide contra el día 1' : ''}
          </div>
        </div>
      )}
    </>)}

    {/* La region se completa al primer uso, propuesta desde la zona de quien
        captura. No es un formulario aparte y no bloquea la captura. */}
    {pdv && !pdv.region && (
      <div className="nota">
        Zona de esta tienda:{' '}
        <select value={region} onChange={e => setRegion(e.target.value)}
                aria-label="Región de la tienda"
                style={{ width: 'auto', display: 'inline-block', minHeight: 40, padding: '6px 10px' }}>
          <option value="">sin definir</option>
          {(meta.regiones ?? []).map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
    )}

    {/* Opcional al capturar y obligatoria antes de autorizar: quien anota va
        de prisa, quien firma necesita ver el empaque. */}
    <div>
      <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
        {foto ? 'Tomar la foto otra vez' : 'Foto del código de fecha (opcional)'}
        <input type="file" accept="image/*" capture="environment" hidden
               onChange={async e => {
                 const archivo = e.target.files?.[0];
                 e.target.value = '';
                 if (!archivo) return;
                 try { setFoto(await comprimir(archivo)); }
                 catch { setError('No se pudo procesar la foto. Intenta de nuevo.'); }
               }} />
      </label>
      {foto && (
        <div className="prod" style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
          <img src={foto} alt="Foto del código de fecha" width={72} height={72}
               style={{ objectFit: 'cover', borderRadius: 10, flex: 'none' }} />
          <div style={{ flex: 1 }}>
            <div className="c">Se guarda con esta línea.</div>
          </div>
          <button className="btn ghost compacto" onClick={() => setFoto(null)}>Quitar</button>
        </div>
      )}
    </div>

    <button id="guardar" className="btn" disabled={guardando} onClick={() => guardar(false)}>
      {guardando ? 'Guardando…' : 'Guardar y escanear'}
    </button>
    <button className="btn ghost sm" onClick={onCancelar}>Cancelar</button>
  </>);
}

function Lista({ filas, pdv, onVolver }) {
  const [tab, setTab] = useState('tienda');
  const [hist, setHist] = useState(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (tab !== 'historial' || hist) return;
    setCargando(true);
    fetch('/api/captura?historial=1&dias=30')
      .then(r => r.json())
      .then(d => setHist(d.filas ?? []))
      .catch(() => setHist([]))
      .finally(() => setCargando(false));
  }, [tab, hist]);

  const datos = tab === 'tienda' ? filas : (hist ?? []);

  return (<>
    <div>
      <h1>{tab === 'tienda' ? 'Capturado en esta tienda' : 'Mi historial'}</h1>
      <p className="sub">{tab === 'tienda' ? pdv.nombre : 'Lo que has capturado en los últimos 30 días'}</p>
    </div>

    <div className="tabs">
      <button className={tab === 'tienda' ? 'on' : ''} onClick={() => setTab('tienda')}>Esta tienda</button>
      <button className={tab === 'historial' ? 'on' : ''} onClick={() => setTab('historial')}>Mi historial</button>
    </div>

    <div className="list">
      {cargando ? <div className="vacio">Cargando…</div>
        : datos.length ? datos.map(f => (
          <div key={f.id} className="row" style={{ cursor: 'default' }}>
            <div style={{ flex: 1 }}>
              <div className="nm">{f.descripcion ?? 'Sin catálogo'}</div>
              <div className="mt">
                {unidades(f.cantidad)} · vence {fechaCorta(f.fecha_vencimiento, f.fecha_precision)}
                {tab === 'historial' && f.pdv_nombre ? ` · ${f.pdv_nombre}` : ''}
                {f.sin_cruce_catalogo ? ' · sin catálogo' : ''}
              </div>
            </div>
            <span className={`pill p-${f.estado ?? 'vencido'}`}>{f.dias_restantes} d</span>
          </div>
        )) : (
          <div className="vacio">
            {tab === 'tienda'
              ? 'Todavía no hay nada capturado aquí.'
              : 'No has capturado nada en los últimos 30 días.'}
          </div>
        )}
    </div>
    <button className="btn" onClick={onVolver}>Seguir capturando</button>
  </>);
}
