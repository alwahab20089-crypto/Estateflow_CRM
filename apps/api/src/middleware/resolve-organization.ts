import type { RequestHandler } from 'express';
import { AppError } from '../utils/app-error';
import { asyncHandler } from '../utils/async-handler';
import { isObjectId } from '../utils/object-id';

/**
 * Determines WHICH organization the client is asking about. The result is only a candidate:
 * requireMembership must verify it against the database before anything trusts it.
 */
export const resolveOrganization = (source: 'param' | 'header'): RequestHandler =>
  asyncHandler(async (req, _res, next) => {
    const candidate: unknown = source === 'param' ? req.params.organizationId : req.get('x-organization-id');

    if (candidate === undefined && source === 'header') {
      throw AppError.badRequest('The X-Organization-Id header is required.', 'ORGANIZATION_REQUIRED');
    }

    // Malformed and unknown ids look identical to "not a member": 404, no existence disclosure.
    if (!isObjectId(candidate)) throw AppError.notFound('Organization not found');
    req.requestedOrganizationId = candidate;
    next();
  });