// src/features/deals/deal-constants.ts
import type { DealStage } from '@/types/deals';

/** The ONE place the UI knows about stages. Mirrors apps/api/src/modules/deals/deal.lifecycle.ts, which is the authority. */
export const DEAL_STAGES: Array<{ value: DealStage; label: string; order: number; terminal: boolean }> = [
  { value: 'NEW', label: 'New', order: 0, terminal: false },
  { value: 'QUALIFICATION', label: 'Qualification', order: 1, terminal: false },
  { value: 'PROPERTY_MATCHED', label: 'Property Matched', order: 2, terminal: false },
  { value: 'VIEWING_SCHEDULED', label: 'Viewing Scheduled', order: 3, terminal: false },
  { value: 'NEGOTIATION', label: 'Negotiation', order: 4, terminal: false },
  { value: 'CONTRACT', label: 'Contract', order: 5, terminal: false },
  { value: 'WON', label: 'Won', order: 6, terminal: true },
  { value: 'LOST', label: 'Lost', order: 7, terminal: true },
];
const byValue = new Map(DEAL_STAGES.map((s) => [s.value, s]));
export const stageLabel = (s: DealStage) => byValue.get(s)?.label ?? s;
export const isTerminal = (s: DealStage) => byValue.get(s)?.terminal ?? false;
export const OPEN_STAGES = DEAL_STAGES.filter((s) => !s.terminal).map((s) => s.value);
/** Close-won is allowed only from these stages. */
export const CLOSE_WON_FROM: DealStage[] = ['NEGOTIATION', 'CONTRACT'];
export const canCloseWon = (s: DealStage) => CLOSE_WON_FROM.includes(s);

/** Open stages: forward one step, or back to any earlier stage. The server refuses anything else. */
export function allowedStageMoves(from: DealStage): DealStage[] {
  const cur = byValue.get(from);
  if (!cur || cur.terminal) return [];
  return OPEN_STAGES.filter((s) => s !== from && (byValue.get(s)?.order ?? 99) <= cur.order + 1);
}