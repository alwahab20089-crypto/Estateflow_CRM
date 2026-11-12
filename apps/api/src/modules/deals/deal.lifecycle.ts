import { DEAL_STAGES, DEALABLE_PROPERTY_STATUSES } from '../../constants';
import { AppError } from '../../utils/app-error';

export type DealStage = (typeof DEAL_STAGES)[number];

export const STAGE_CONFIG: Record<DealStage, { order: number; probability: number; terminal: boolean; label: string }> = {
  NEW: { order: 0, probability: 10, terminal: false, label: 'New' },
  QUALIFICATION: { order: 1, probability: 20, terminal: false, label: 'Qualification' },
  PROPERTY_MATCHED: { order: 2, probability: 35, terminal: false, label: 'Property Matched' },
  VIEWING_SCHEDULED: { order: 3, probability: 50, terminal: false, label: 'Viewing Scheduled' },
  NEGOTIATION: { order: 4, probability: 70, terminal: false, label: 'Negotiation' },
  CONTRACT: { order: 5, probability: 90, terminal: false, label: 'Contract' },
  WON: { order: 6, probability: 100, terminal: true, label: 'Won' },
  LOST: { order: 7, probability: 0, terminal: true, label: 'Lost' },
};

export const OPEN_DEAL_STAGES = DEAL_STAGES.filter((s) => !STAGE_CONFIG[s].terminal);
export const TERMINAL_DEAL_STAGES = DEAL_STAGES.filter((s) => STAGE_CONFIG[s].terminal);
/** Stages a deal may be closed as WON from. */
export const CLOSE_WON_FROM: readonly DealStage[] = ['NEGOTIATION', 'CONTRACT'];
/** Stage a reopened deal returns to. */
export const REOPEN_STAGE: DealStage = 'NEGOTIATION';
export const isDealable = (propertyStatus: string) => (DEALABLE_PROPERTY_STATUSES as readonly string[]).includes(propertyStatus);

/**
 * Open stages: move forward one step at a time, or back to any earlier open stage.
 * WON/LOST are reached only through close-won / close-lost, and left only through reopen.
 */
export function assertStageTransition(from: DealStage, to: DealStage) {
  if (STAGE_CONFIG[from].terminal) throw AppError.conflict('This deal is closed. Reopen it before changing its stage.', 'DEAL_CLOSED');
  if (STAGE_CONFIG[to].terminal) {
    throw new AppError(422, 'Use the close-won or close-lost action to close a deal.', 'INVALID_STAGE_TRANSITION', [{ path: 'stage', message: 'Use close-won or close-lost' }]);
  }
  if (from === to) throw new AppError(422, 'The deal is already in this stage.', 'INVALID_STAGE_TRANSITION', [{ path: 'stage', message: 'Already in this stage' }]);
  if (STAGE_CONFIG[to].order > STAGE_CONFIG[from].order + 1) {
    throw new AppError(422, `Cannot skip from ${STAGE_CONFIG[from].label} to ${STAGE_CONFIG[to].label}.`, 'INVALID_STAGE_TRANSITION', [{ path: 'stage', message: 'Stages cannot be skipped' }]);
  }
}