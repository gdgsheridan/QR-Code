import 'server-only';
import { after } from 'next/server';
import { cookieAuthenticator } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { emailFrom, getProvider } from '@/lib/email';
import { drainUntilIdle } from '@/lib/email/drain';
import { env } from '@/lib/env';
import { route } from '@/lib/http/route';
import { googleSheetReader } from '@/lib/ingest/sync';
import { createAdminApi, type AdminApi } from './handlers';

function adminApi(): AdminApi {
  return createAdminApi({
    db: db(),
    authenticate: cookieAuthenticator,
    scheduleDrain: (task) => after(task),
    appOrigin: env().NEXT_PUBLIC_APP_ORIGIN,
    passSecret: env().PASS_TOKEN_SECRET,
    drain: () => drainUntilIdle({ db: db(), provider: getProvider(), appOrigin: env().NEXT_PUBLIC_APP_ORIGIN, from: emailFrom(), passSecret: env().PASS_TOKEN_SECRET }),
    sheetReader: (sheetId) => {
      const serviceAccount = env().GOOGLE_SERVICE_ACCOUNT_JSON;
      return serviceAccount ? googleSheetReader(sheetId, serviceAccount) : null;
    },
  });
}

// One line per route file: `export const GET = adminRoute('dashboard');`
export function adminRoute(name: keyof AdminApi) {
  return route(async (request: Request, ctx: { params: Promise<Record<string, string>> }) => adminApi()[name](request, await ctx.params));
}
