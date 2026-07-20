import { createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { env } from '../../config/env.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) {
    await reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  const session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    await reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  request.userId = session.userId;
}

function serializeUser(user: {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  birthYear: number | null;
  gender: string | null;
  countryCode: string;
  // Langue de contenu (titres/résumés) choisie dans les Paramètres.
  language?: string;
  provider: string;
  passwordHash?: string | null;
  googleId?: string | null;
  facebookId?: string | null;
  appleId?: string | null;
  discordId?: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    coverUrl: user.coverUrl,
    birthYear: user.birthYear,
    gender: user.gender,
    countryCode: user.countryCode,
    language: user.language ?? 'fr',
    provider: user.provider,
    // Méthodes de connexion liées à ce compte (pour l'écran « comptes liés »).
    linkedProviders: {
      password: Boolean(user.passwordHash),
      google: Boolean(user.googleId),
      facebook: Boolean(user.facebookId),
      apple: Boolean(user.appleId),
      discord: Boolean(user.discordId),
    },
  };
}

async function createSession(userId: string) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + env.SESSION_DURATION_DAYS * 86_400_000);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt };
}

// ---------------------------------------------------------------------------
// SSO — vérification des jetons auprès du fournisseur (côté serveur uniquement).
// ---------------------------------------------------------------------------

type Provider = 'google' | 'facebook' | 'apple' | 'discord';
const ID_FIELD = { google: 'googleId', facebook: 'facebookId', apple: 'appleId', discord: 'discordId' } as const;

type OAuthProfile = {
  providerId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
};

// Provider SSO non configuré côté serveur (identifiants d'app absents) : on
// REFUSE le jeton (fail closed) au lieu de sauter le contrôle d'audience —
// sinon un jeton émis pour l'app d'un attaquant permettrait de prendre le
// contrôle d'un compte. Erreur dédiée → réponse 400 provider_not_configured
// (distincte du 401 invalid_oauth_token d'un jeton réellement invalide).
class NotConfiguredError extends Error {
  constructor(provider: Provider) {
    super(`${provider}_not_configured`);
  }
}

// Vérifie un ID token Google via l'endpoint tokeninfo et contrôle l'audience.
// FAIL CLOSED : sans GOOGLE_CLIENT_IDS on ne peut pas contrôler l'audience →
// provider refusé (un jeton émis pour n'importe quelle app serait accepté).
async function verifyGoogleToken(idToken: string): Promise<OAuthProfile> {
  const allowed = env.GOOGLE_CLIENT_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) throw new NotConfiguredError('google');
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!res.ok) throw new Error('google_verify_failed');
  const data = (await res.json()) as Record<string, string | undefined>;
  if (!data.sub) throw new Error('google_no_sub');
  if (!data.aud || !allowed.includes(data.aud)) {
    throw new Error('google_bad_audience');
  }
  return {
    providerId: data.sub,
    email: data.email ?? null,
    emailVerified: data.email_verified === 'true' || (data.email_verified as unknown) === true,
    displayName: data.name || data.email || 'Utilisateur',
    avatarUrl: data.picture ?? null,
  };
}

// Vérifie un access token Facebook via le Graph API.
async function verifyFacebookToken(accessToken: string): Promise<OAuthProfile> {
  // Contrôle d'audience : un access token Facebook est émis POUR UNE app donnée.
  // Sans ce contrôle, un token obtenu par n'importe quelle autre app Facebook
  // (même id utilisateur) serait accepté → prise de contrôle de compte. On
  // interroge donc debug_token avec le App Access Token (APP_ID|APP_SECRET) et
  // on exige que le jeton appartienne bien à NOTRE app et soit valide.
  // FAIL CLOSED : identifiants absents → provider refusé (jamais de vérification sautée).
  const appId = env.FACEBOOK_APP_ID.trim();
  const appSecret = env.FACEBOOK_APP_SECRET.trim();
  if (!appId || !appSecret) throw new NotConfiguredError('facebook');
  const dbg = await fetch(
    `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
  );
  if (!dbg.ok) throw new Error('facebook_verify_failed');
  const dbgData = (await dbg.json()) as { data?: { app_id?: string; is_valid?: boolean } };
  if (dbgData.data?.app_id !== appId || dbgData.data?.is_valid !== true) {
    throw new Error('facebook_bad_audience');
  }
  const res = await fetch(
    `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!res.ok) throw new Error('facebook_verify_failed');
  const data = (await res.json()) as {
    id?: string;
    name?: string;
    email?: string;
    picture?: { data?: { url?: string } };
  };
  if (!data.id) throw new Error('facebook_no_id');
  return {
    providerId: data.id,
    email: data.email ?? null,
    emailVerified: true, // Facebook ne renvoie l'e-mail que s'il est vérifié.
    displayName: data.name || 'Utilisateur',
    avatarUrl: data.picture?.data?.url ?? null,
  };
}

// Vérifie un access token Discord via /users/@me.
async function verifyDiscordToken(accessToken: string): Promise<OAuthProfile> {
  // Contrôle d'audience : /users/@me accepte un token émis pour N'IMPORTE quelle
  // app Discord (prise de contrôle de compte). oauth2/@me, lui, renvoie l'app à
  // laquelle le token est rattaché — on exige que ce soit NOTRE application.
  // FAIL CLOSED : identifiant absent → provider refusé (jamais de vérification sautée).
  const clientId = env.DISCORD_CLIENT_ID.trim();
  if (!clientId) throw new NotConfiguredError('discord');
  const authRes = await fetch('https://discord.com/api/oauth2/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!authRes.ok) throw new Error('discord_verify_failed');
  const authData = (await authRes.json()) as { application?: { id?: string } };
  if (authData.application?.id !== clientId) throw new Error('discord_bad_audience');
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('discord_verify_failed');
  const data = (await res.json()) as {
    id?: string;
    username?: string;
    global_name?: string | null;
    email?: string | null;
    verified?: boolean;
    avatar?: string | null;
  };
  if (!data.id) throw new Error('discord_no_id');
  const avatar = data.avatar
    ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`
    : null;
  return {
    providerId: data.id,
    email: data.email ?? null,
    emailVerified: Boolean(data.verified && data.email),
    displayName: data.global_name || data.username || 'Utilisateur',
    avatarUrl: avatar,
  };
}

// ---------------------------------------------------------------------------
// Sign in with Apple : le client (expo-apple-authentication) obtient un
// identityToken (JWT RS256 signé par Apple). On le vérifie ici SANS dépendance
// externe : clés publiques JWKS d'Apple (cache mémoire 24 h) + crypto natif
// Node, puis contrôle des claims (émetteur, expiration, audience = bundle id).
// ---------------------------------------------------------------------------

type AppleJwk = { kty: string; kid: string; alg?: string; n: string; e: string };
let appleKeysCache: { keys: AppleJwk[]; fetchedAt: number } | null = null;
const APPLE_KEYS_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchAppleKeys(forceRefresh = false): Promise<AppleJwk[]> {
  const now = Date.now();
  if (!forceRefresh && appleKeysCache && now - appleKeysCache.fetchedAt < APPLE_KEYS_TTL_MS) {
    return appleKeysCache.keys;
  }
  const res = await fetch('https://appleid.apple.com/auth/keys');
  if (!res.ok) throw new Error('apple_keys_unavailable');
  const data = (await res.json()) as { keys?: AppleJwk[] };
  if (!Array.isArray(data.keys) || data.keys.length === 0) throw new Error('apple_keys_invalid');
  appleKeysCache = { keys: data.keys, fetchedAt: now };
  return data.keys;
}

function decodeJwtPart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
}

async function verifyAppleToken(identityToken: string): Promise<OAuthProfile> {
  const audience = env.APPLE_BUNDLE_ID.trim();
  if (!audience) throw new NotConfiguredError('apple');

  const [headerPart, payloadPart, signaturePart, extra] = identityToken.split('.');
  if (!headerPart || !payloadPart || !signaturePart || extra !== undefined) {
    throw new Error('apple_token_malformed');
  }
  let header: { alg?: string; kid?: string };
  let payload: {
    iss?: string;
    aud?: string;
    exp?: number;
    sub?: string;
    email?: string;
    email_verified?: string | boolean;
  };
  try {
    header = decodeJwtPart(headerPart);
    payload = decodeJwtPart(payloadPart);
  } catch {
    throw new Error('apple_token_malformed');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('apple_token_bad_header');

  // Signature RS256 : clé publique Apple correspondant au `kid` du jeton.
  // Si le kid est inconnu (rotation de clés), on force un rafraîchissement.
  let jwk = (await fetchAppleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await fetchAppleKeys(true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('apple_unknown_key');
  const publicKey = createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
  const signatureOk = cryptoVerify(
    'RSA-SHA256',
    Buffer.from(`${headerPart}.${payloadPart}`),
    publicKey,
    Buffer.from(signaturePart, 'base64url'),
  );
  if (!signatureOk) throw new Error('apple_bad_signature');

  // Claims : émetteur Apple, non expiré, émis POUR NOTRE app (audience).
  if (payload.iss !== 'https://appleid.apple.com') throw new Error('apple_bad_issuer');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
    throw new Error('apple_token_expired');
  }
  if (payload.aud !== audience) throw new Error('apple_bad_audience');
  if (!payload.sub) throw new Error('apple_no_sub');

  return {
    providerId: payload.sub,
    // Apple ne transmet l'e-mail qu'au premier login (ou relais privé) ; le
    // jeton porte email_verified en chaîne OU booléen selon les versions.
    email: payload.email ?? null,
    emailVerified: payload.email_verified === 'true' || payload.email_verified === true,
    // Apple n'envoie JAMAIS le nom dans le jeton : le client le fournit à part
    // (champ displayName de /oauth, utilisé uniquement à la création du compte).
    displayName: 'Utilisateur',
    avatarUrl: null,
  };
}

async function verifyOAuth(provider: Provider, token: string): Promise<OAuthProfile> {
  if (provider === 'google') return verifyGoogleToken(token);
  if (provider === 'facebook') return verifyFacebookToken(token);
  if (provider === 'discord') return verifyDiscordToken(token);
  if (provider === 'apple') return verifyAppleToken(token);
  throw new Error('provider_not_supported');
}

// Connexion SSO en 3 temps :
//   1) un compte est déjà lié à ce (provider, id) → connexion ;
//   2) sinon, si l'e-mail (vérifié) correspond à un compte existant → on LIE ce
//      provider à ce compte (l'utilisateur retrouve son compte mot de passe) ;
//   3) sinon → nouveau compte.
async function loginOrLinkOAuth(provider: Provider, profile: OAuthProfile) {
  const field = ID_FIELD[provider];
  const byProvider = await prisma.user.findFirst({ where: { [field]: profile.providerId } });
  if (byProvider) return byProvider;

  if (profile.email && profile.emailVerified) {
    const byEmail = await prisma.user.findFirst({ where: { email: profile.email } });
    if (byEmail) {
      return prisma.user.update({
        where: { id: byEmail.id },
        data: { [field]: profile.providerId, avatarUrl: byEmail.avatarUrl ?? profile.avatarUrl },
      });
    }
  }

  return prisma.user.create({
    data: {
      provider,
      providerId: profile.providerId,
      [field]: profile.providerId,
      email: profile.email,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      countryCode: env.DEFAULT_COUNTRY,
    },
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Contrôle d'audience OAuth : sans les identifiants d'app, on ne peut pas
  // vérifier que le jeton a été émis pour NOTRE app → le provider est REFUSÉ
  // (fail closed, 400 provider_not_configured). On l'annonce au démarrage.
  if (!env.FACEBOOK_APP_ID.trim() || !env.FACEBOOK_APP_SECRET.trim()) {
    app.log.warn(
      'SSO facebook DÉSACTIVÉ (fail closed) : variable manquante (FACEBOOK_APP_ID/FACEBOOK_APP_SECRET).',
    );
  }
  if (!env.DISCORD_CLIENT_ID.trim()) {
    app.log.warn('SSO discord DÉSACTIVÉ (fail closed) : variable manquante (DISCORD_CLIENT_ID).');
  }

  // Quels providers SSO sont configurés côté serveur (le mobile adapte son écran).
  // On expose les IDs PUBLICS (client id Google, app id Facebook) pour que le
  // client s'auto-configure sans rebuild — ce ne sont pas des secrets.
  app.get('/api/auth/providers', async () => {
    const googleClientId = env.GOOGLE_CLIENT_IDS.split(',').map((s) => s.trim()).filter(Boolean)[0] ?? '';
    const discordClientId = env.DISCORD_CLIENT_ID.trim();
    return {
      google: googleClientId.length > 0,
      googleClientId,
      // Client IDs Google dédiés aux builds NATIFS (expo-auth-session). Vides
      // tant que les apps iOS/Android ne sont pas créées dans la console
      // Google ; penser à les ajouter aussi à GOOGLE_CLIENT_IDS (audience).
      googleIosClientId: env.GOOGLE_IOS_CLIENT_ID.trim(),
      googleAndroidClientId: env.GOOGLE_ANDROID_CLIENT_ID.trim(),
      facebook: env.FACEBOOK_APP_ID.trim().length > 0,
      facebookAppId: env.FACEBOOK_APP_ID.trim(),
      discord: discordClientId.length > 0,
      discordClientId,
      // Sign in with Apple (natif iOS) : la vérification ne demande aucun
      // secret — seulement l'audience attendue (APPLE_BUNDLE_ID).
      apple: env.APPLE_BUNDLE_ID.trim().length > 0,
      password: true,
    };
  });

  // Connexion / inscription via SSO. Idempotent : crée le compte, ou le relie à
  // un compte existant si l'e-mail vérifié correspond (voir loginOrLinkOAuth).
  app.post('/api/auth/oauth', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (request, reply) => {
    const body = z
      .object({
        provider: z.enum(['google', 'facebook', 'discord', 'apple']),
        token: z.string().min(1),
        // Apple n'envoie le nom qu'au CLIENT (fullName du premier login) : le
        // mobile le transmet ici. Utilisé UNIQUEMENT à la création du compte
        // (loginOrLinkOAuth n'écrit displayName que dans prisma.user.create).
        displayName: z.string().min(1).max(80).optional(),
      })
      .parse(request.body);
    let profile: OAuthProfile;
    try {
      profile = await verifyOAuth(body.provider, body.token);
    } catch (err) {
      if (err instanceof NotConfiguredError) {
        return reply.code(400).send({ error: 'provider_not_configured' });
      }
      return reply.code(401).send({ error: 'invalid_oauth_token' });
    }
    if (body.displayName?.trim()) profile.displayName = body.displayName.trim();
    const user = await loginOrLinkOAuth(body.provider, profile);
    const session = await createSession(user.id);
    return { user: serializeUser(user), token: session.token, expiresAt: session.expiresAt };
  });

  // Lier une méthode SSO au compte connecté (depuis les réglages « comptes liés »).
  app.post('/api/auth/link', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } }, preHandler: requireAuth }, async (request, reply) => {
    const body = z
      .object({ provider: z.enum(['google', 'facebook', 'discord', 'apple']), token: z.string().min(1) })
      .parse(request.body);
    let profile: OAuthProfile;
    try {
      profile = await verifyOAuth(body.provider, body.token);
    } catch (err) {
      if (err instanceof NotConfiguredError) {
        return reply.code(400).send({ error: 'provider_not_configured' });
      }
      return reply.code(401).send({ error: 'invalid_oauth_token' });
    }
    const field = ID_FIELD[body.provider];
    // Déjà rattaché à un AUTRE compte ? refus (on ne vole pas une identité).
    const taken = await prisma.user.findFirst({ where: { [field]: profile.providerId } });
    if (taken && taken.id !== request.userId) {
      return reply.code(409).send({ error: 'already_linked_other_account' });
    }
    const user = await prisma.user.update({
      where: { id: request.userId },
      data: { [field]: profile.providerId },
    });
    return { user: serializeUser(user) };
  });

  // Délier une méthode SSO — refusé s'il ne reste plus aucun moyen de connexion.
  app.post('/api/auth/unlink', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({ provider: z.enum(['google', 'facebook', 'apple', 'discord']) }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) return reply.code(404).send({ error: 'not_found' });
    const field = ID_FIELD[body.provider];
    const methods = [
      Boolean(user.passwordHash),
      Boolean(user.googleId),
      Boolean(user.facebookId),
      Boolean(user.appleId),
      Boolean(user.discordId),
    ].filter(Boolean).length;
    if (methods <= 1 && Boolean(user[field])) {
      return reply.code(400).send({ error: 'last_login_method' });
    }
    const updated = await prisma.user.update({ where: { id: user.id }, data: { [field]: null } });
    return { user: serializeUser(updated) };
  });

  // Fallback e-mail / mot de passe — inscription (multi-comptes).
  // Rate limit serré : empêche le spam de création de comptes.
  app.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    // Inscription e-mail désactivée en prod : les nouveaux comptes passent par
    // Google/Discord (aucun mot de passe à perdre). Le login e-mail existant
    // (POST /api/auth/login) et l'OAuth restent ouverts.
    if (!env.ALLOW_EMAIL_SIGNUP) {
      return reply.code(403).send({
        error: 'email_signup_disabled',
        message: 'La création de compte se fait avec Google ou Discord.',
      });
    }
    const body = z
      .object({
        displayName: z.string().min(1).max(80),
        email: z.string().email(),
        password: z.string().min(8).max(200),
      })
      .parse(request.body);
    const existing = await prisma.user.findFirst({
      where: { provider: 'password', email: body.email },
    });
    if (existing) return reply.code(409).send({ error: 'email_taken' });
    const user = await prisma.user.create({
      data: {
        displayName: body.displayName,
        email: body.email,
        passwordHash: await bcrypt.hash(body.password, 10),
        provider: 'password',
        countryCode: env.DEFAULT_COUNTRY,
      },
    });
    const session = await createSession(user.id);
    return { user: serializeUser(user), token: session.token, expiresAt: session.expiresAt };
  });

  // Fallback e-mail / mot de passe — connexion.
  // Rate limit serré : ralentit fortement le brute-force de mots de passe.
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (request, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string() }).parse(request.body);
    const user = await prisma.user.findFirst({
      where: { provider: 'password', email: body.email },
    });
    if (!user?.passwordHash || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    // Purge opportuniste des sessions expirées de ce compte (pas de cron nécessaire).
    await prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
    const session = await createSession(user.id);
    return { user: serializeUser(user), token: session.token, expiresAt: session.expiresAt };
  });

  // ---------------------------------------------------------------------------
  // Mot de passe oublié — réinitialisation par ré-authentification SSO.
  // Le flux OAuth est le MÊME que le login (le client obtient un jeton
  // Google/Discord côté web puis le poste ici) : le « mode reset » est porté
  // par cet endpoint dédié. Le compte est identifié UNIQUEMENT par
  // (provider, providerId) — jamais par e-mail — puis on délivre un jeton de
  // réinitialisation à usage unique valable 10 minutes (stocké en DB pour
  // survivre à un restart).
  app.post('/api/auth/reset-password/init', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (request, reply) => {
    const body = z
      .object({ provider: z.enum(['google', 'facebook', 'discord']), token: z.string().min(1) })
      .parse(request.body);
    let profile: OAuthProfile;
    try {
      profile = await verifyOAuth(body.provider, body.token);
    } catch (err) {
      if (err instanceof NotConfiguredError) {
        return reply.code(400).send({ error: 'provider_not_configured' });
      }
      return reply.code(401).send({ error: 'invalid_oauth_token' });
    }
    const field = ID_FIELD[body.provider];
    const user = await prisma.user.findFirst({ where: { [field]: profile.providerId } });
    if (!user) return reply.code(404).send({ error: 'no_account_for_identity' });
    // Un seul jeton actif à la fois : purge les précédents (et les expirés).
    await prisma.passwordResetToken.deleteMany({
      where: { OR: [{ userId: user.id }, { expiresAt: { lt: new Date() } }] },
    });
    const resetToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await prisma.passwordResetToken.create({ data: { token: resetToken, userId: user.id, expiresAt } });
    return { resetToken, expiresAt };
  });

  // Pose le nouveau mot de passe avec le jeton délivré ci-dessus. Le jeton est
  // à usage unique : marqué consommé dans la même transaction que le hash.
  app.post('/api/auth/reset-password', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (request, reply) => {
    const body = z
      .object({ resetToken: z.string().min(1), newPassword: z.string().min(8).max(200) })
      .parse(request.body);
    const stored = await prisma.passwordResetToken.findUnique({ where: { token: body.resetToken } });
    if (!stored) return reply.code(401).send({ error: 'invalid_reset_token' });
    if (stored.usedAt || stored.expiresAt < new Date()) {
      return reply.code(400).send({ error: 'reset_token_expired' });
    }
    // Si l'appelant est connecté (reset depuis les Paramètres), on préserve SA
    // session ; toutes les autres sont invalidées, comme au changement classique.
    const header = request.headers.authorization;
    const currentToken = header?.startsWith('Bearer ') ? header.slice(7) : '';
    await prisma.$transaction([
      prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash: await bcrypt.hash(body.newPassword, 10) },
      }),
      prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
      prisma.session.deleteMany({ where: { userId: stored.userId, token: { not: currentToken } } }),
    ]);
    return { ok: true };
  });

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (request) => {
    const header = request.headers.authorization;
    const token = header?.slice(7) ?? '';
    await prisma.session.deleteMany({ where: { token } });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) return reply.code(404).send({ error: 'not_found' });
    return { user: serializeUser(user) };
  });

  app.post('/api/auth/password', { preHandler: requireAuth }, async (request, reply) => {
    const body = z
      .object({ currentPassword: z.string(), newPassword: z.string().min(8).max(200) })
      .parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user?.passwordHash || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const header = request.headers.authorization;
    const currentToken = header?.slice(7) ?? '';
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(body.newPassword, 10) },
    });
    // Changement de mot de passe : invalide toutes les AUTRES sessions.
    await prisma.session.deleteMany({ where: { userId: user.id, token: { not: currentToken } } });
    return { ok: true };
  });

  // Suppression définitive du compte et de toutes ses données (RGPD).
  // Le catalogue partagé (séries/films/épisodes) n'est PAS touché.
  app.delete('/api/auth/account', { preHandler: requireAuth }, async (request) => {
    const userId = request.userId;
    await prisma.$transaction([
      prisma.commentReaction.deleteMany({ where: { userId } }),
      prisma.comment.deleteMany({ where: { userId } }),
      prisma.rating.deleteMany({ where: { userId } }),
      prisma.watchEvent.deleteMany({ where: { userId } }),
      prisma.userEpisodeStatus.deleteMany({ where: { userId } }),
      prisma.userMediaStatus.deleteMany({ where: { userId } }),
      prisma.listItem.deleteMany({ where: { list: { userId } } }),
      prisma.mediaList.deleteMany({ where: { userId } }),
      prisma.follow.deleteMany({ where: { OR: [{ followerId: userId }, { followingId: userId }] } }),
      prisma.notification.deleteMany({ where: { userId } }),
      prisma.import.deleteMany({ where: { userId } }),
      prisma.session.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);
    return { ok: true };
  });
}
