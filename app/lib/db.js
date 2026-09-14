import postgres from 'postgres';

// Conexion por el pooler de Supabase (puerto 6543). Vercel abre y cierra
// funciones constantemente; sin pooler se agotan las conexiones de Postgres.
// max:1 porque cada invocacion serverless es independiente.
const globalRef = globalThis;

export const sql =
  globalRef.__pvencerSql ??
  postgres(process.env.DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // requerido por el pooler en modo transaccion
    connection: { search_path: 'pvencer, extensions, public' },
  });

if (process.env.NODE_ENV !== 'production') globalRef.__pvencerSql = sql;

// Toda escritura importante deja rastro. Es el requisito de auditoria RF-29.
export async function registrarBitacora({ usuarioId, entidad, entidadId, accion, antes, despues, ip }) {
  try {
    await sql`
      insert into pvencer.bitacora (usuario_id, entidad, entidad_id, accion, valor_anterior, valor_nuevo, direccion_ip)
      values (${usuarioId ?? null}, ${entidad}, ${entidadId ?? null}, ${accion},
              ${antes ? sql.json(antes) : null}, ${despues ? sql.json(despues) : null},
              ${ip ?? null})`;
  } catch (e) {
    // La bitacora no debe tumbar la operacion del usuario, pero si debe verse en los logs
    console.error('bitacora', e);
  }
}
