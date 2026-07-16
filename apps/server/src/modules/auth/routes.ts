import { randomBytes } from 'node:crypto';
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

// Vérifie un ID token Google via l'endpoint tokeninfo et contrôle l'audience.
async function verifyGoogleToken(idToken: string): Promise<OAuthProfile> {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!res.ok) throw new Error('google_verify_failed');
  const data = (await res.json()) as Record<string, string | undefined>;
  if (!data.sub) throw new Error('google_no_sub');
  const allowed = env.GOOGLE_CLIENT_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length > 0 && (!data.aud || !allowed.includes(data.aud))) {
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
  const appId = env.FACEBOOK_APP_ID.trim();
  const appSecret = env.FACEBOOK_APP_SECRET.trim();
  if (appId && appSecret) {
    const dbg = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
    );
    if (!dbg.ok) throw new Error('facebook_verify_failed');
    const dbgData = (await dbg.json()) as { data?: { app_id?: string; is_valid?: boolean } };
    if (dbgData.data?.app_id !== appId || dbgData.data?.is_valid !== true) {
      throw new Error('facebook_bad_audience');
    }
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
  const clientId = env.DISCORD_CLIENT_ID.trim();
  if (clientId) {
    const authRes = await fetch('https://discord.com/api/oauth2/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!authRes.ok) throw new Error('discord_verify_failed');
    const authData = (await authRes.json()) as { application?: { id?: string } };
    if (authData.application?.id !== clientId) throw new Error('discord_bad_audience');
  }
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

async function verifyOAuth(provider: Provider, token: string): Promise<OAuthProfile> {
  if (provider === 'google') return verifyGoogleToken(token);
  if (provider === 'facebook') return verifyFacebookToken(token);
  if (provider === 'discord') return verifyDiscordToken(token);
  throw new Error('provider_not_supported'); // Apple : à venir.
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
  // vérifier que le jeton a été émis pour NOTRE app. On garde alors le
  // comportement actuel (pas de blocage en dev/prod tant que les vars ne sont
  // pas posées) mais on l'annonce clairement au démarrage.
  if (!env.FACEBOOK_APP_ID.trim() || !env.FACEBOOK_APP_SECRET.trim()) {
    app.log.warn(
      'Vérification d’audience OAuth facebook désactivée : variable manquante (FACEBOOK_APP_ID/FACEBOOK_APP_SECRET).',
    );
  }
  if (!env.DISCORD_CLIENT_ID.trim()) {
    app.log.warn('Vérification d’audience OAuth discord désactivée : variable manquante (DISCORD_CLIENT_ID).');
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
      facebook: env.FACEBOOK_APP_ID.trim().length > 0,
      facebookAppId: env.FACEBOOK_APP_ID.trim(),
      discord: discordClientId.length > 0,
      discordClientId,
      apple: false, // à venir (nécessite un compte Apple Developer).
      password: true,
    };
  });

  // Connexion / inscription via SSO. Idempotent : crée le compte, ou le relie à
  // un compte existant si l'e-mail vérifié correspond (voir loginOrLinkOAuth).
  app.post('/api/auth/oauth', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (request, reply) => {
    const body = z
      .object({ provider: z.enum(['google', 'facebook', 'discord']), token: z.string().min(1) })
      .parse(request.body);
    let profile: OAuthProfile;
    try {
      profile = await verifyOAuth(body.provider, body.token);
    } catch {
      return reply.code(401).send({ error: 'invalid_oauth_token' });
    }
    const user = await loginOrLinkOAuth(body.provider, profile);
    const session = await createSession(user.id);
    return { user: serializeUser(user), token: session.token, expiresAt: session.expiresAt };
  });

  // Lier une méthode SSO au compte connecté (depuis les réglages « comptes liés »).
  app.post('/api/auth/link', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } }, preHandler: requireAuth }, async (request, reply) => {
    const body = z
      .object({ provider: z.enum(['google', 'facebook', 'discord']), token: z.string().min(1) })
      .parse(request.body);
    let profile: OAuthProfile;
    try {
      profile = await verifyOAuth(body.provider, body.token);
    } catch {
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
    } catch {
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
