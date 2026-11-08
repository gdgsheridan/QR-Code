import { createCateringShareHandler } from '@/lib/admin/catering';
import { db } from '@/lib/db/server';
import { env } from '@/lib/env';
import { route } from '@/lib/http/route';

// SPEC §11, §9.3 (v0.11.39): the Catering share link. Authenticated by the link's key in the body; 30/min per link.
export const POST = route((request) => createCateringShareHandler({ db: db(), passSecret: env().PASS_TOKEN_SECRET })(request));
