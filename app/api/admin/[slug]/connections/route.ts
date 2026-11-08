import { adminRoute } from '@/lib/admin/server';

export const GET = adminRoute('listConnections');
export const DELETE = adminRoute('removeConnection');
