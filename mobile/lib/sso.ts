import { Platform } from 'react-native';

// Aide SSO côté WEB APP : charge les SDK officiels Google/Facebook et récupère
// un jeton à envoyer au serveur (/api/auth/oauth ou /link). Le natif (Expo Go)
// n'est pas encore géré ici (viendra avec expo-auth-session).

export function ssoWebAvailable(): boolean {
  return Platform.OS === 'web' && typeof document !== 'undefined';
}

const loaded = new Set<string>();
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (loaded.has(src)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      loaded.add(src);
      resolve();
    };
    s.onerror = () => reject(new Error('script_load_failed'));
    document.head.appendChild(s);
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

// Google Identity Services : on initialise avec le client id et on rend le
// bouton officiel dans `el`. Le callback reçoit un id_token (JWT) à vérifier
// côté serveur.
export async function initGoogleButton(
  clientId: string,
  el: HTMLElement,
  onToken: (idToken: string) => void,
): Promise<void> {
  await loadScript('https://accounts.google.com/gsi/client');
  const g = window.google;
  if (!g?.accounts?.id) throw new Error('gsi_unavailable');
  g.accounts.id.initialize({
    client_id: clientId,
    callback: (resp: { credential?: string }) => {
      if (resp?.credential) onToken(resp.credential);
    },
  });
  el.innerHTML = '';
  g.accounts.id.renderButton(el, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'center',
    width: 300,
  });
}

// Discord (implicit grant) : ouvre une popup vers Discord, qui redirige vers
// /oauth/discord (page statique) laquelle nous renvoie le token par postMessage.
export function discordLogin(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const redirect = `${window.location.origin}/oauth/discord`;
    const url =
      `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}` +
      `&response_type=token&scope=${encodeURIComponent('identify email')}` +
      `&redirect_uri=${encodeURIComponent(redirect)}`;
    const popup = window.open(url, 'discord_sso', 'width=500,height=750');
    if (!popup) return reject(new Error('popup_blocked'));

    let settled = false;
    const cleanup = () => {
      window.removeEventListener('message', onMsg);
      clearInterval(timer);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; provider?: string; token?: string | null } | null;
      if (d?.type === 'sso' && d.provider === 'discord') {
        settled = true;
        cleanup();
        try { popup.close(); } catch { /* ignore */ }
        if (d.token) resolve(d.token);
        else reject(new Error('discord_cancelled'));
      }
    };
    window.addEventListener('message', onMsg);
    // Popup fermée sans token → annulation.
    const timer = setInterval(() => {
      if (popup.closed && !settled) {
        cleanup();
        reject(new Error('discord_cancelled'));
      }
    }, 500);
  });
}

// Facebook Login : ouvre la popup et renvoie un access token (à vérifier côté
// serveur via le Graph API).
export async function facebookLogin(appId: string): Promise<string> {
  await loadScript('https://connect.facebook.net/fr_FR/sdk.js');
  const FB = window.FB;
  if (!FB) throw new Error('fb_unavailable');
  FB.init({ appId, cookie: true, xfbml: false, version: 'v19.0' });
  return new Promise((resolve, reject) => {
    FB.login(
      (resp: { authResponse?: { accessToken?: string } }) => {
        const token = resp?.authResponse?.accessToken;
        if (token) resolve(token);
        else reject(new Error('facebook_cancelled'));
      },
      { scope: 'public_profile,email' },
    );
  });
}
