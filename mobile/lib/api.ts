import { router } from 'expo-router';
import { useAppStore } from './store';
import { CONFIGURED_SERVER_URL } from './config';

export class ApiError extends Error {
  status: number;
  code: string;
  // Message lisible renvoyé par le serveur (champ `message`), quand il existe —
  // ex. modération d'un commentaire bloqué. `undefined` sinon.
  serverMessage?: string;
  constructor(status: number, code: string, serverMessage?: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.serverMessage = serverMessage;
  }
}

// URL effective : la valeur « bakée » (production) prime, sinon celle saisie (dev).
export function resolvedServerUrl(): string | null {
  return CONFIGURED_SERVER_URL ?? useAppStore.getState().serverUrl;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { token } = useAppStore.getState();
  const serverUrl = resolvedServerUrl();
  if (!serverUrl) throw new ApiError(0, 'no_server');
  const res = await fetch(`${serverUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    // Session expirée (hors écrans d'authentification, où le 401 est une réponse
    // normale) : déconnexion + retour à l'écran de connexion, au lieu de laisser
    // des écrans vides « aucun résultat ». Seulement si un jeton avait bien été
    // envoyé : sinon (store pas encore réhydraté), on laisse la garde des onglets
    // gérer sans effacer la session.
    if (token && !path.startsWith('/api/auth/')) {
      useAppStore.getState().logout();
      router.replace('/setup');
    }
    throw new ApiError(401, (data && data.error) || 'unauthorized');
  }
  if (!res.ok)
    throw new ApiError(res.status, (data && data.error) || 'request_failed', data && data.message);
  return data as T;
}

// Envoi de fichier (multipart) : utilisé par l'import TV Time. On NE fixe PAS
// le Content-Type — le navigateur/RN pose lui-même le boundary du multipart.
async function upload<T>(path: string, file: Blob, filename: string): Promise<T> {
  const { token } = useAppStore.getState();
  const serverUrl = resolvedServerUrl();
  if (!serverUrl) throw new ApiError(0, 'no_server');
  const form = new FormData();
  // Le 3e argument (filename) est requis côté serveur (@fastify/multipart).
  form.append('file', file as Blob, filename);
  const res = await fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    if (token && !path.startsWith('/api/auth/')) {
      useAppStore.getState().logout();
      router.replace('/setup');
    }
    throw new ApiError(401, (data && data.error) || 'unauthorized');
  }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'request_failed');
  return data as T;
}

// Téléchargement binaire (POST, réponse non-JSON) : utilisé par l'export au
// format TV Time (ZIP). Même gestion du jeton et du 401 que request(), mais la
// réponse est rendue telle quelle en Blob.
async function download(path: string): Promise<Blob> {
  const { token } = useAppStore.getState();
  const serverUrl = resolvedServerUrl();
  if (!serverUrl) throw new ApiError(0, 'no_server');
  const res = await fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 401) {
    if (token && !path.startsWith('/api/auth/')) {
      useAppStore.getState().logout();
      router.replace('/setup');
    }
    throw new ApiError(401, 'unauthorized');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, (data && data.error) || 'request_failed', data && data.message);
  }
  return await res.blob();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload,
  download,
};

// Construit l'URL d'une image. Les chemins TMDb (« /abc.jpg ») sont préfixés ;
// les URL absolues (TheTVDB, http) et les images embarquées (data:) passent tel quel.
export function tmdbImage(path: string | null | undefined, size = 'w342'): string | null {
  if (!path) return null;
  if (path.startsWith('http') || path.startsWith('data:')) return path;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

export async function checkHealth(url: string): Promise<{ ok: boolean; app: string; version: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/health`, { signal: controller.signal });
    if (!res.ok) throw new ApiError(res.status, 'invalid_response');
    const data = await res.json();
    // Accepte l'ancien nom : un serveur pas encore redéployé répond « SerieTime ».
    if (data?.ok !== true || (data?.app !== 'PlotTime' && data?.app !== 'SerieTime')) throw new ApiError(200, 'invalid_server');
    return data;
  } finally {
    clearTimeout(t);
  }
}
