import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, sendPasswordResetEmail,
  signOut, onAuthStateChanged, type Auth, type User
} from 'firebase/auth';

function resolveFirebaseConfig() {
  const raw = {
    apiKey: ((import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) ?? '').trim(),
    authDomain: ((import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) ?? '').trim(),
    projectId: ((import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) ?? '').trim(),
    storageBucket: ((import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) ?? '').trim(),
    messagingSenderId: ((import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) ?? '').trim(),
    appId: ((import.meta.env.VITE_FIREBASE_APP_ID as string | undefined) ?? '').trim()
  };

  const values = Object.values(raw).filter(Boolean);

  let apiKey = raw.apiKey;
  let appId = raw.appId;
  let authDomain = raw.authDomain;
  let storageBucket = raw.storageBucket;
  let messagingSenderId = raw.messagingSenderId;
  let projectId = raw.projectId;

  // Detectar y auto-corregir variables intercambiadas o mal asignadas:
  // 1. Formato de appId (1:<digits>:web:<hash>)
  const foundAppId = values.find(v => /^1:\d+:web:[a-f0-9]+$/i.test(v));
  if (foundAppId) appId = foundAppId;

  // 2. Formato de authDomain (termina en .firebaseapp.com)
  const foundAuthDomain = values.find(v => /\.firebaseapp\.com$/i.test(v));
  if (foundAuthDomain) authDomain = foundAuthDomain;

  // 3. Formato de storageBucket (termina en .firebasestorage.app o .appspot.com)
  const foundStorage = values.find(v => /\.(firebasestorage\.app|appspot\.com)$/i.test(v));
  if (foundStorage) storageBucket = foundStorage;

  // 4. messagingSenderId: dígitos numéricos (8-16 caracteres) o derivado del appId
  const foundSender = values.find(v => /^\d{8,16}$/.test(v));
  if (foundSender) {
    messagingSenderId = foundSender;
  } else if (appId && /^1:(\d+):web:/.test(appId)) {
    const match = appId.match(/^1:(\d+):web:/);
    if (match) messagingSenderId = match[1];
  }

  // 5. projectId: slug válido (letras minúsculas, números, guiones; sin dos puntos ni puntos)
  if (!projectId || projectId.includes(':') || projectId.includes('.')) {
    if (authDomain && authDomain.includes('.firebaseapp.com')) {
      projectId = authDomain.replace('.firebaseapp.com', '');
    } else if (storageBucket && storageBucket.includes('.')) {
      projectId = storageBucket.split('.')[0];
    } else {
      const candidate = values.find(v => /^[a-z0-9-]+$/i.test(v) && !/^\d+$/.test(v) && !v.includes(':'));
      if (candidate) projectId = candidate;
    }
  }

  // Si authDomain no se especificó, inferir del projectId
  if (!authDomain && projectId) {
    authDomain = `${projectId}.firebaseapp.com`;
  }

  return { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId };
}

const cfg = resolveFirebaseConfig();

/** true cuando hay configuración válida de Firebase; si no, la app corre solo local. */
export const remoteEnabled = Boolean(cfg.apiKey && cfg.projectId && !cfg.projectId.includes(':'));

let app: FirebaseApp | null = null;
let firestore: Firestore | null = null;
let auth: Auth | null = null;

export function getRemote() {
  if (!remoteEnabled) return null;
  if (!app) { app = initializeApp(cfg); firestore = getFirestore(app); auth = getAuth(app); }
  return { app: app!, firestore: firestore!, auth: auth! };
}

export function watchUser(cb: (u: User | null) => void): () => void {
  const r = getRemote();
  if (!r) { cb(null); return () => {}; }
  return onAuthStateChanged(r.auth, cb);
}

/**
 * Usuario y contraseña: las cuentas las crea el administrador en la consola de Firebase
 * (Authentication → Users → Add user). La app no tiene registro público.
 */
export async function loginWithPassword(email: string, password: string) {
  const r = getRemote();
  if (!r) throw new Error('La sincronización remota no está configurada.');
  await signInWithEmailAndPassword(r.auth, email.trim(), password);
}
export async function loginWithGoogle() {
  const r = getRemote();
  if (!r) throw new Error('La sincronización remota no está configurada.');
  await signInWithPopup(r.auth, new GoogleAuthProvider());
}
export async function resetPassword(email: string) {
  const r = getRemote();
  if (!r) throw new Error('La sincronización remota no está configurada.');
  await sendPasswordResetEmail(r.auth, email.trim());
}
export async function logout() { const r = getRemote(); if (r) await signOut(r.auth); }

/** Mensajes de error de Firebase Auth en lenguaje claro. */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string }).code ?? '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Usuario o contraseña incorrectos.';
  if (code.includes('too-many-requests')) return 'Demasiados intentos. Espera unos minutos.';
  if (code.includes('network-request-failed')) return 'Sin conexión: no se pudo verificar el usuario.';
  if (code.includes('user-disabled')) return 'Esta cuenta está desactivada. Contacta al administrador.';
  if (code.includes('popup-blocked')) return 'El navegador bloqueó la ventana emergente. Habilita las ventanas emergentes o ingresa con correo y contraseña.';
  if (code.includes('popup-closed-by-user')) return 'Ventana de inicio de sesión cerrada.';
  if (code.includes('unauthorized-domain')) return 'Dominio web no autorizado en Firebase Authentication. Añádelo en la consola de Firebase.';
  return (e as Error)?.message || 'No se pudo iniciar sesión.';
}
