
import type { DealDto, DealStage } from '@/types/deals';

export const makeDeal = (over: Partial<DealDto> = {}): DealDto => ({
  _id: 'd1',
  title: 'Villa for Lucas',
  description: null,
  contactId: 'c1',
  contact: { _id: 'c1', fullName: 'Lucas Meyer' },
  leadId: null,
  lead: null,
  propertyId: 'p1',
  property: {
    _id: 'p1',
    title: 'Garden Villa',
    city: 'Lahore',
    propertyStatus: 'AVAILABLE',
  },
  dealType: 'SALE',
  stage: 'NEW',
  valueAmount: 24_000_000,
  currency: 'USD',
  probability: 10,
  expectedClosingDate: '2026-12-15T12:00:00.000Z',
  actualClosingDate: null,
  assignedTo: 'u1',
  assignee: {
    _id: 'u1',
    name: 'Ayesha Khan',
    email: 'a@x.com',
  },
  lostReason: null,
  notes: null,
  stageChangedAt: null,
  createdBy: 'u1',
  deletedAt: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  ...over,
});

export const summary = (
  rows: Array<[DealStage, number, number]>,
) =>
  rows.map(([stage, count, totalAmount]) => ({
    stage,
    currency: 'USD',
    count,
    totalAmount,
  }));
