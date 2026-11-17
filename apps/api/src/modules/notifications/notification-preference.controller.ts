import { getAuth } from '../../middleware/authenticate';
import { getTenant } from '../../middleware/require-membership';
import { sendSuccess } from '../../utils/api-response';
import { asyncHandler } from '../../utils/async-handler';
import * as prefs from './notification-preference.service';

export const get = asyncHandler(async (req, res) =>
  sendSuccess(res, { data: await prefs.getPreferences(getTenant(req), getAuth(req).userId) }));
export const update = asyncHandler(async (req, res) =>
  sendSuccess(res, { message: 'Preferences updated', data: await prefs.updatePreferences(getTenant(req), getAuth(req).userId, req.body) }));