// Charge le fichier .env dans process.env AVANT toute lecture de configuration.
// Sans cela, ce module lit process.env trop tôt (avant l'init de Prisma) et
// ignore silencieusement toutes les valeurs du .env (clés TMDb/TheTVDB, secrets…).
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('file:./data/serietime.sqlite'),
  APP_NAME: z.string().default('SerieTime'),
  APP_URL: z.string().default('http://localhost:4000'),
  APP_SECRET: z.string().default('change-me'),
  JWT_SECRET: z.string().default('change-me'),
  SESSION_DURATION_DAYS: z.coerce.number().default(30),
  TMDB_API_KEY: z.string().default(''),
  TMDB_READ_ACCESS_TOKEN: z.string().default(''),
  // SSO — audiences Google acceptées (Client IDs Web/Android/iOS, séparés par des virgules)
  // et identifiants de l'app Facebook Login. Laisser vide désactive le provider concerné.
  GOOGLE_CLIENT_IDS: z.string().default(''),
  FACEBOOK_APP_ID: z.string().default(''),
  FACEBOOK_APP_SECRET: z.string().default(''),
  DISCORD_CLIENT_ID: z.string().default(''),
  // NB : z.coerce.boolean() rendrait "false" -> true. On parse la chaîne explicitement.
  TVMAZE_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v == null ? true : v.trim().toLowerCase() === 'true' || v.trim() === '1')),
  TVDB_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v == null ? false : v.trim().toLowerCase() === 'true' || v.trim() === '1')),
  // Inscription e-mail/mot de passe : désactivée en prod (`ALLOW_EMAIL_SIGNUP=false`)
  // pour que les NOUVEAUX comptes passent forcément par Google/Discord (aucun mot
  // de passe → aucune perte). Par défaut ON (les tests créent des comptes via
  // /api/auth/register ; le login e-mail des comptes existants reste inchangé).
  ALLOW_EMAIL_SIGNUP: z
    .string()
    .optional()
    .transform((v) => (v == null ? true : v.trim().toLowerCase() === 'true' || v.trim() === '1')),
  TVDB_API_KEY: z.string().default(''),
  TVDB_PIN: z.string().default(''),
  TWITCH_CLIENT_ID: z.string().default(''),
  TWITCH_CLIENT_SECRET: z.string().default(''),
  IGDB_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  STEAM_API_KEY: z.string().default(''),
  DEFAULT_LANGUAGE: z.string().default('fr-FR'),
  DEFAULT_COUNTRY: z.string().default('FR'),
  DEFAULT_TIMEZONE: z.string().default('Europe/Paris'),
  MAX_IMPORT_ZIP_SIZE_MB: z.coerce.number().default(100),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173,capacitor://localhost,https://localhost'),
});

export const env = envSchema.parse(process.env);

export const APP_VERSION = '1.0.0';
