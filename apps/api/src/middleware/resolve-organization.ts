import type { RequestHandler } from 'express';
import { OrganizationMember } from '../modules/members/member.model';
import { AppError } from '../utils/app-error';
import { asyncHandler } from '../utils/async-handler';
import { isObjectId } from '../utils/object-id';
import { getAuth } from './authenticate';

/**
 * Determines WHICH organization the client is asking about. The result is only a candidate:
 * requireMembership must verify it against the database before anything trusts it.
 *
 * Self-hosted installs have one organization, so the header is optional: when it is absent and the
 * user belongs to exactly one active organization, that one is used. Otherwise the header is required.
 */
export const resolveOrganization = (source: 'param' | 'header'): RequestHandler =>
  asyncHandler(async (req, _res, next) => {
    const candidate: unknown = source === 'param' ? req.params.organizationId : req.get('x-organization-id');

    if (candidate === undefined && source === 'header') {
      const memberships = await OrganizationMember.find({
        userId: getAuth(req).userId,
        status: 'ACTIVE',
        invitationStatus: 'ACCEPTED',
      })
        .select('organizationId')
        .limit(2)
        .lean();

      if (memberships.length !== 1) {
        throw AppError.badRequest('The X-Organization-Id header is required.', 'ORGANIZATION_REQUIRED');
      }
      req.requestedOrganizationId = String(memberships[0]!.organizationId);
      return next();
    }

    // Malformed and unknown ids look identical to "not a member": 404, no existence disclosure.
    if (!isObjectId(candidate)) throw AppError.notFound('Organization not found');
    req.requestedOrganizationId = candidate;
    next();
  });