import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { DEAL_STAGES, DEAL_TYPES, MAX_MINOR_UNITS } from '../../constants';

const text = (max: number) => ({ type: String, trim: true, maxlength: max });

const dealSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: text(5000),
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
    dealType: { type: String, enum: DEAL_TYPES, required: true },
    stage: { type: String, enum: DEAL_STAGES, default: 'NEW' },
    valueAmount: { type: Number, required: true, min: 1, max: MAX_MINOR_UNITS, validate: { validator: Number.isInteger, message: 'Must be an integer number of minor units' } },
    currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
    probability: { type: Number, min: 0, max: 100, default: 10 },
    expectedClosingDate: { type: Date, default: null },
    actualClosingDate: { type: Date, default: null },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lostReason: text(1000),
    notes: text(5000),
    stageChangedAt: { type: Date, default: Date.now },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    searchKeywords: { type: [String], default: [], select: false },
  },
  { timestamps: true },
);

dealSchema.index({ organizationId: 1, deletedAt: 1, createdAt: -1 });
dealSchema.index({ organizationId: 1, stage: 1, deletedAt: 1 });
dealSchema.index({ organizationId: 1, assignedTo: 1, stage: 1 });
dealSchema.index({ organizationId: 1, propertyId: 1, stage: 1 });
dealSchema.index({ organizationId: 1, contactId: 1 });
dealSchema.index({ organizationId: 1, leadId: 1 });
dealSchema.index({ organizationId: 1, expectedClosingDate: 1 });
dealSchema.index({ organizationId: 1, searchKeywords: 1 });
// Database-level backstop for "no two WON deals on one property", even if two closes race.
dealSchema.index(
  { organizationId: 1, propertyId: 1 },
  { unique: true, partialFilterExpression: { stage: 'WON', deletedAt: { $type: 'null' } }, name: 'one_won_deal_per_property' },
);

export type DealDoc = HydratedDocument<InferSchemaType<typeof dealSchema>>;
export const Deal = model('Deal', dealSchema);