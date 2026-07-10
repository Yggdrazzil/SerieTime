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
  provider: string;
  passwordHash?: string | null;
  googleId?: string | null;
  facebookId?: string | null;
  appleId?: string | null;
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
    provider: user.provider,
    // Méthodes de connexion liées à ce compte (pour l'écran « comptes liés »).
    linkedProviders: {
      password: Boolean(user.passwordHash),
      google: Boolean(user.googleId),
      facebook: Boolean(user.facebookId),
      apple: Boolean(user.appleId),
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

type Provider = 'google' | 'facebook' | 'apple';
const ID_FIELD = { google: 'googleId', facebook: 'facebookId', apple: 'appleId' } as const;

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

async function verifyOAuth(provider: Provider, token: string): Promise<OAuthProfile> {
  if (provider === 'google') return verifyGoogleToken(token);
  if (provider === 'facebook') return verifyFacebookToken(token);
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
  // Quels providers SSO sont configurés côté serveur (le mobile adapte son écran).
  app.get('/api/auth/providers', async () => ({
    google: env.GOOGLE_CLIENT_IDS.trim().length > 0,
    facebook: env.FACEBOOK_APP_ID.trim().length > 0,
    apple: false, // à venir (nécessite un compte Apple Developer).
    password: true,
  }));

  // Connexion / inscription via SSO. Idempotent : crée le compte, ou le relie à
  // un compte existant si l'e-mail vérifié correspond (voir loginOrLinkOAuth).
  app.post('/api/auth/oauth', async (request, reply) => {
    const body = z
      .object({ provider: z.enum(['google', 'facebook']), token: z.string().min(1) })
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
  app.post('/api/auth/link', { preHandler: requireAuth }, async (request, reply) => {
    const body = z
      .object({ provider: z.enum(['google', 'facebook']), token: z.string().min(1) })
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
    const body = z.object({ provider: z.enum(['google', 'facebook', 'apple']) }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) return reply.code(404).send({ error: 'not_found' });
    const field = ID_FIELD[body.provider];
    const methods = [
      Boolean(user.passwordHash),
      Boolean(user.googleId),
      Boolean(user.facebookId),
      Boolean(user.appleId),
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
