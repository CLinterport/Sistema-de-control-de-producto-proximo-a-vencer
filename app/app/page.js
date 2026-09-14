'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Login() {
  const router = useRouter();
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [fase, setFase] = useState('login'); // login | cambiar
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setError(''); setCargando(true);
    try {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, clave }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? 'No se pudo entrar.'); return; }
      // Nadie sigue usando la clave temporal del piloto
      if (d.debeCambiar) { setFase('cambiar'); return; }
      router.push('/inicio');
    } catch {
      setError('Sin conexión. Revisa tu señal e intenta de nuevo.');
    } finally { setCargando(false); }
  }

  async function cambiar(e) {
    e.preventDefault();
    setError('');
    if (nueva.length < 8) return setError('La clave debe tener al menos 8 caracteres.');
    if (nueva !== repetida) return setError('Las dos claves no coinciden.');
    setCargando(true);
    try {
      const r = await fetch('/api/clave', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nueva }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? 'No se pudo cambiar la clave.'); return; }
      router.push('/inicio');
    } finally { setCargando(false); }
  }

  if (fase === 'cambiar') return (
    <form className="centro" onSubmit={cambiar}>
      <div>
        <h1>Cambia tu clave</h1>
        <p className="sub">Estás usando la clave temporal. Elige una propia para continuar.</p>
      </div>
      {error && <div className="err">{error}</div>}
      <div>
        <label className="lbl" htmlFor="n">Nueva clave</label>
        <input id="n" type="password" value={nueva} onChange={e => setNueva(e.target.value)}
               autoComplete="new-password" />
      </div>
      <div>
        <label className="lbl" htmlFor="r">Repite la clave</label>
        <input id="r" type="password" value={repetida} onChange={e => setRepetida(e.target.value)}
               autoComplete="new-password" />
      </div>
      <button className="btn" disabled={cargando}>{cargando ? 'Guardando…' : 'Guardar y entrar'}</button>
    </form>
  );

  return (
    <form className="centro" onSubmit={entrar}>
      <div>
        <h1>Próximos a vencer</h1>
        <p className="sub">Entra con el usuario que te dieron.</p>
      </div>
      {error && <div className="err">{error}</div>}
      <div>
        <label className="lbl" htmlFor="u">Usuario</label>
        <input id="u" type="text" value={usuario} onChange={e => setUsuario(e.target.value)}
               autoCapitalize="none" autoCorrect="off" autoComplete="username" />
      </div>
      <div>
        <label className="lbl" htmlFor="c">Clave</label>
        <input id="c" type="password" value={clave} onChange={e => setClave(e.target.value)}
               autoComplete="current-password" />
      </div>
      <button className="btn" disabled={cargando || !usuario || !clave}>
        {cargando ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
