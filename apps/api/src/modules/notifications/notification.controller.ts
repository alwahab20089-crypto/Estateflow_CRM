import { getAuth } from '../../middleware/authenticate';
import { getTenant } from '../../middleware/require-membership';
import { sendSuccess } from '../../utils/api-response';
import { asyncHandler } from '../../utils/async-handler';
import * as notifications from './notification.service';
import { listNotificationsQuerySchema } from './notification.validation';

const ctx = (req: Parameters<typeof getAuth>[0]) => ({ tenant: getTenant(req), userId: getAuth(req).userId });
const paramId = (req: { params: Record<string, string | string[] | undefined> }) => String(req.params.id);

export const list = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  const r = await notifications.listNotifications(tenant, userId, listNotificationsQuerySchema.parse(req.query));
  sendSuccess(res, { data: r.items, meta: r.meta });
});
export const unreadCount = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  sendSuccess(res, { data: { count: await notifications.unreadCount(tenant, userId) } });
});
export const markRead = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  sendSuccess(res, { message: 'Notification marked as read', data: await notifications.markRead(tenant, userId, paramId(req)) });
});
export const markAllRead = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  sendSuccess(res, { message: 'All notifications marked as read', data: await notifications.markAllRead(tenant, userId) });
});
export const remove = asyncHandler(async (req, res) => {
  const { tenant, userId } = ctx(req);
  await notifications.removeNotification(tenant, userId, paramId(req));
  sendSuccess(res, { message: 'Notification deleted' });
});