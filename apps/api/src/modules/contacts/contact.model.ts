import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { CONTACT_METHODS, CONTACT_STATUSES, CONTACT_TYPES, LEAD_SOURCES } from '../../constants';
import { isValidPhone } from '../../utils/phone';

const phoneField = {
  type: String,
  trim: true,
  maxlength: 20,
  validate: { validator: (v: string) => !v || isValidPhone(v), message: 'Enter a valid phone number' },
};
const text = (max: number) => ({ type: String, trim: true, maxlength: max });

const contactSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    linkedLeadId: { type: Schema.Types.ObjectId, ref: 'Lead' }, // the lead this contact was created from
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    firstName: { type: String, required: true, trim: true, maxlength: 100 },
    lastName: { type: String, trim: true, maxlength: 100, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 }, // optional: not every contact has one
    phone: phoneField,
    alternatePhone: phoneField,
    contactType: { type: String, enum: CONTACT_TYPES, default: 'OTHER' },
    status: { type: String, enum: CONTACT_STATUSES, default: 'ACTIVE' },
    tags: {
      type: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],
      default: [],
      validate: { validator: (v: string[]) => v.length <= 20, message: 'At most 20 tags' },
    },
    company: text(150),
    jobTitle: text(100),
    address: text(300),
    city: text(100),
    country: text(100),
    preferredContactMethod: { type: String, enum: CONTACT_METHODS },
    preferredLanguage: text(40),
    source: { type: String, enum: LEAD_SOURCES },
    notes: text(5000),
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // internal, never serialized (fullName is computed in the serializer)
    nameSort: { type: String, default: '' },
    searchKeywords: { type: [String], default: [], select: false },
  },
  { timestamps: true },
);

contactSchema.index({ organizationId: 1, deletedAt: 1, createdAt: -1 });
contactSchema.index({ organizationId: 1, assignedTo: 1, status: 1 });
contactSchema.index({ organizationId: 1, contactType: 1, createdAt: -1 });
contactSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
contactSchema.index({ organizationId: 1, nameSort: 1 });
contactSchema.index({ organizationId: 1, searchKeywords: 1 });
contactSchema.index({ organizationId: 1, tags: 1 });
contactSchema.index({ organizationId: 1, phone: 1 });
// One ACTIVE contact per email per organization (archived contacts free the email up).
contactSchema.index(
  { organizationId: 1, email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' }, deletedAt: { $type: 'null' } }, name: 'unique_active_email_per_org' },
);
// One contact can be created from a given lead: this makes repeated or concurrent conversions safe.
contactSchema.index(
  { organizationId: 1, linkedLeadId: 1 },
  { unique: true, partialFilterExpression: { linkedLeadId: { $type: 'objectId' } }, name: 'one_contact_per_lead' },
);

export type ContactDoc = HydratedDocument<InferSchemaType<typeof contactSchema>>;
export const Contact = model('Contact', contactSchema);