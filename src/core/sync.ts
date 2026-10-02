import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db, getMeta, setMeta } from './db';
import { getRemote, remoteEnabled } from './firebase';
import type { StoredRecord } from './types';

/**
 * Sincronización simple y robusta para trabajo de campo:
 *  1. PUSH: todo lo local con _sync='pending' se sube (última escritura gana por updatedAt).
 *  2. PULL: se bajan los registros remotos con updatedAt > última sincronización.
 * Firestore ruta: registros/{formId}/items/{GlobalRecordId}
 */
export type SyncResult = { pushed: number; pulled: number; error?: string };

export async function syncForm(formId: string): Promise<SyncResult> {
  if (!remoteEnabled) return { pushed: 0, pulled: 0, error: 'La sincronización remota no está configurada.' };
  if (!navigator.onLine) return { pushed: 0, pulled: 0, error: 'Sin conexión a internet. Los registros están a salvo en tu dispositivo.' };
  const r = getRemote();
  if (!r) return { pushed: 0, pulled: 0, error: 'No se pudo conectar a Firebase.' };
  if (!r.auth.currentUser) return { pushed: 0, pulled: 0, error: 'Inicia sesión para sincronizar.' };
  const col = collection(r.firestore, 'registros', formId, 'items');
  let pushed = 0, pulled = 0;
  try {
    // PUSH
    const pending = await db.records.where('_sync').equals('pending').and(x => x.formId === formId).toArray();
    for (const rec of pending) {
      const { _sync, ...payload } = rec;
      await setDoc(doc(col, rec.GlobalRecordId), payload, { merge: true });
      await db.records.update(rec.GlobalRecordId, { _sync: 'synced' });
      pushed++;
    }
    // PULL
    const lastPull = await getMeta<string>(`lastPull:${formId}`, '1970-01-01T00:00:00.000Z');
    const snap = await getDocs(query(col, where('updatedAt', '>', lastPull)));
    let maxSeen = lastPull;
    for (const d of snap.docs) {
      const remote = d.data() as Omit<StoredRecord, '_sync'>;
      const local = await db.records.get(remote.GlobalRecordId);
      if (!local || local.updatedAt < remote.updatedAt) {
        await db.records.put({ ...remote, _sync: 'synced' });
        pulled++;
      }
      if (remote.updatedAt > maxSeen) maxSeen = remote.updatedAt;
    }
    await setMeta(`lastPull:${formId}`, maxSeen);
    return { pushed, pulled };
  } catch (e) {
    console.error('Error durante la sincronización:', e);
    const err = e as { code?: string; message?: string };
    let msg = err.message || String(e);
    if (err.code === 'permission-denied') {
      msg = 'Permiso denegado: tu usuario no tiene permisos autorizados en Firestore.';
    } else if (err.code === 'unavailable') {
      msg = 'Servidor temporalmente no disponible. Intenta de nuevo en unos momentos.';
    }
    return { pushed, pulled, error: msg };
  }
}

/** Sincroniza automáticamente al recuperar conexión o cada 5 minutos. */
export function autoSync(formId: string, onDone: (r: SyncResult) => void) {
  const run = () => syncForm(formId).then(r => {
    // En autosync solo notificamos si hubo cambios reales o error
    if (r.pushed > 0 || r.pulled > 0 || r.error) {
      onDone(r);
    }
  });
  window.addEventListener('online', run);
  const t = window.setInterval(() => { if (navigator.onLine) run(); }, 5 * 60 * 1000);
  run();
  return () => { window.removeEventListener('online', run); window.clearInterval(t); };
}
