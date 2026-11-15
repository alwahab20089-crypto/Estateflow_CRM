import { Types } from 'mongoose';
import { Deal } from '../src/modules/deals/deal.model';
import { Lead } from '../src/modules/leads/lead.model';
import { Property } from '../src/modules/properties/property.model';
import { Task } from '../src/modules/tasks/task.model';

export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
export const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);
export const ymdUtc = (d: Date) => d.toISOString().slice(0, 10);
/** Fixed-timezone query strings so tests never depend on where they run. */
export const P30 = 'period=30d&timezone=UTC';
export const custom = (fromDaysAgo: number, toDaysAgo = 0) => `period=custom&from=${ymdUtc(daysAgo(fromDaysAgo))}&to=${ymdUtc(daysAgo(toDaysAgo))}&timezone=UTC`;

/**
 * Raw inserts so createdAt / convertedAt / closing dates are exactly what the test says.
 * Expected numbers for the last 30 days (UTC), asserted by the tests:
 *  leads: cohort 4 (L1 qualified+converted A, L2 new A, L3 lost B, L4 won+converted unassigned); previous period 2; archived L6 ignored; snapshot total 6
 *  deals: open D1 (USD 100k, 70%) + D2 (USD 50k, 10%) => pipeline USD 150k, weighted 75k; won D3 (USD 200k) + D4 (PKR 30M); lost D5; D6 archived; D7 won in previous period
 *  properties: 5 active records (P1..P5), on market 3, available 2; P6 archived
 *  tasks: T1,T2 completed (1 on time), T3 overdue, T4 in progress (future), T5 cancelled, T7 archived
 */
export async function seedAnalytics(org: string, creator: string, agentA: string, agentB: string) {
  const O = new Types.ObjectId(org);
  const U = new Types.ObjectId(creator);
  const A = new Types.ObjectId(agentA);
  const B = new Types.ObjectId(agentB);
  const base = { organizationId: O, createdBy: U, deletedAt: null, updatedAt: new Date() };
  const oid = () => new Types.ObjectId();

  const lead = (o: Record<string, unknown>) => ({ ...base, firstName: 'Lead', lastName: 'Test', phone: '+15550100100', leadSource: 'WEBSITE', leadType: 'BUYER', status: 'NEW', priority: 'MEDIUM', assignedTo: null, ...o });
  await Lead.collection.insertMany([
    lead({ firstName: 'L1', assignedTo: A, status: 'QUALIFIED', createdAt: daysAgo(5), convertedAt: daysAgo(2), convertedContactId: oid() }),
    lead({ firstName: 'L2', assignedTo: A, leadSource: 'FACEBOOK', status: 'NEW', createdAt: daysAgo(6) }),
    lead({ firstName: 'L3', assignedTo: B, status: 'LOST', createdAt: daysAgo(7) }),
    lead({ firstName: 'L4', status: 'WON', createdAt: daysAgo(8), convertedAt: daysAgo(1), convertedContactId: oid() }),
    lead({ firstName: 'L5', assignedTo: B, createdAt: daysAgo(40) }),
    lead({ firstName: 'L6', assignedTo: A, status: 'QUALIFIED', createdAt: daysAgo(3), deletedAt: new Date() }),
    lead({ firstName: 'L7', createdAt: daysAgo(35) }),
  ]);

  const deal = (o: Record<string, unknown>) => ({ ...base, title: 'Deal', contactId: oid(), propertyId: oid(), dealType: 'SALE', stage: 'NEW', valueAmount: 1_000_000, currency: 'USD', probability: 10, assignedTo: null, stageChangedAt: new Date(), ...o });
  await Deal.collection.insertMany([
    deal({ title: 'D1', stage: 'NEGOTIATION', probability: 70, valueAmount: 10_000_000, assignedTo: A, createdAt: daysAgo(10) }),
    deal({ title: 'D2', stage: 'NEW', probability: 10, valueAmount: 5_000_000, assignedTo: B, createdAt: daysAgo(9) }),
    deal({ title: 'D3', stage: 'WON', probability: 100, valueAmount: 20_000_000, assignedTo: A, createdAt: daysAgo(14), actualClosingDate: daysAgo(4) }),
    deal({ title: 'D4', stage: 'WON', probability: 100, valueAmount: 3_000_000_000, currency: 'PKR', assignedTo: A, createdAt: daysAgo(8), actualClosingDate: daysAgo(3) }),
    deal({ title: 'D5', stage: 'LOST', probability: 0, valueAmount: 7_000_000, assignedTo: B, createdAt: daysAgo(12), actualClosingDate: daysAgo(2), lostReason: 'Bought elsewhere' }),
    deal({ title: 'D6', stage: 'NEGOTIATION', valueAmount: 99_000_000, assignedTo: A, createdAt: daysAgo(4), deletedAt: new Date() }),
    deal({ title: 'D7', stage: 'WON', probability: 100, valueAmount: 8_000_000, assignedTo: A, createdAt: daysAgo(50), actualClosingDate: daysAgo(45) }),
  ]);

  const prop = (o: Record<string, unknown>) => ({ ...base, title: 'Property', propertyType: 'HOUSE', listingType: 'SALE', propertyStatus: 'AVAILABLE', priceAmount: 10_000_000, currency: 'PKR', city: 'Lahore', assignedTo: A, createdAt: daysAgo(2), ...o });
  await Property.collection.insertMany([
    prop({ title: 'P1' }),
    prop({ title: 'P2', propertyStatus: 'UNDER_OFFER', priceAmount: 20_000_000 }),
    prop({ title: 'P3', priceAmount: 5_000_000, currency: 'USD', city: 'Dubai', assignedTo: B }),
    prop({ title: 'P4', propertyStatus: 'SOLD', priceAmount: 99_000_000, city: 'Karachi', createdAt: daysAgo(60) }),
    prop({ title: 'P5', propertyStatus: 'DRAFT', city: undefined, listingType: 'RENT', propertyType: 'APARTMENT' }),
    prop({ title: 'P6', deletedAt: new Date() }),
  ]);

  const task = (o: Record<string, unknown>) => ({ ...base, title: 'Task', taskType: 'GENERAL', status: 'TODO', priority: 'MEDIUM', assignedTo: A, dueAt: null, completedAt: null, createdAt: daysAgo(9), ...o });
  await Task.collection.insertMany([
    task({ title: 'T1', status: 'COMPLETED', dueAt: daysAgo(5), completedAt: daysAgo(6) }),
    task({ title: 'T2', status: 'COMPLETED', dueAt: daysAgo(5), completedAt: daysAgo(3), priority: 'HIGH' }),
    task({ title: 'T3', status: 'TODO', dueAt: daysAgo(2) }),
    task({ title: 'T4', status: 'IN_PROGRESS', dueAt: daysAhead(3), assignedTo: B }),
    task({ title: 'T5', status: 'CANCELLED', dueAt: daysAgo(4), assignedTo: B }),
    task({ title: 'T7', status: 'TODO', dueAt: daysAgo(3), deletedAt: new Date() }),
  ]);
}