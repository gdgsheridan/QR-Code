import { adminRoute } from '@/lib/admin/server';

export const POST = adminRoute('linkJudgeBadge');
export const DELETE = adminRoute('unlinkJudgeBadge');
