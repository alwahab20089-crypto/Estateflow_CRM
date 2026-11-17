import { Router, type RequestHandler } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import type { RateLimiters } from '../../middleware/rate-limit';
import { requireMembership } from '../../middleware/require-membership';
import { resolveOrganization } from '../../middleware/resolve-organization';
import { validate } from '../../middleware/validate';
import { requireObjectIdParam } from '../../utils/require-object-id';
import * as c from './automation.controller';
import { createWorkflowSchema, testWorkflowSchema, updateWorkflowSchema } from './automation.validation';

export function createAutomationRouter(limiters: RateLimiters) {
  const router = Router();
  const writesOnly: RequestHandler = (req, res, next) => (req.method === 'GET' ? next() : limiters.write(req, res, next));
  const wf = requireObjectIdParam('workflowId', 'Automation');
  const ex = requireObjectIdParam('executionId', 'Execution');

  router.use(authenticate, resolveOrganization('header'), requireMembership, writesOnly);

  router.get('/', authorize('automations:read'), c.list);
  router.post('/', authorize('automations:create'), validate({ body: createWorkflowSchema }), c.create);

  router.get('/:workflowId', wf, authorize('automations:read'), c.get);
  router.patch('/:workflowId', wf, authorize('automations:update'), validate({ body: updateWorkflowSchema }), c.update);
  router.delete('/:workflowId', wf, authorize('automations:delete'), c.remove);

  router.post('/:workflowId/activate', wf, authorize('automations:activate'), c.activate);
  router.post('/:workflowId/pause', wf, authorize('automations:activate'), c.pause);
  router.post('/:workflowId/test', wf, authorize('automations:execute'), validate({ body: testWorkflowSchema }), c.test);

  router.get('/:workflowId/executions', wf, authorize('automations:execution_read'), c.executions);
  router.get('/:workflowId/executions/:executionId', wf, ex, authorize('automations:execution_read'), c.execution);
  router.post('/:workflowId/executions/:executionId/retry', wf, ex, authorize('automations:retry'), c.retry);
  return router;
}