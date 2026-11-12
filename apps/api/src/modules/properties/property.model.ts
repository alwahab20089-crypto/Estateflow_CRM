import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import {
  AREA_UNITS, FURNISHING_STATUSES, LISTING_TYPES, MAX_MINOR_UNITS, MAX_PROPERTY_IMAGES,
  PROPERTY_STATUSES, PROPERTY_TYPES, RENT_PERIODS,
} from '../../constants';

const text = (max: number) => ({ type: String, trim: true, maxlength: max });
const integerOnly = { validator: Number.isInteger, message: 'Must be an integer number of minor units' };
const money = { type: Number, min: 0, max: MAX_MINOR_UNITS, validate: integerOnly };

const imageSchema = new Schema(
  {
    key: { type: String, required: true }, // storage key, never exposed
    url: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    originalName: text(120),
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const propertySchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: text(10000),
    propertyType: { type: String, enum: PROPERTY_TYPES, required: true },
    listingType: { type: String, enum: LISTING_TYPES, required: true },
    propertyStatus: { type: String, enum: PROPERTY_STATUSES, default: 'AVAILABLE' },
    bedrooms: { type: Number, min: 0, max: 50 },
    bathrooms: { type: Number, min: 0, max: 50 },
    area: { type: Number, min: 0, exclusiveMin: undefined },
    areaUnit: { type: String, enum: AREA_UNITS },
    floors: { type: Number, min: 0, max: 200 },
    furnishingStatus: { type: String, enum: FURNISHING_STATUSES, default: 'NOT_APPLICABLE' },
    parkingSpaces: { type: Number, min: 0, max: 100 },
    yearBuilt: { type: Number, min: 1800, max: 2200 },
    amenities: { type: [{ type: String, trim: true, maxlength: 60 }], default: [] },
    address: text(300),
    city: text(100),
    state: text(100),
    country: text(100),
    postalCode: text(20),
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    locationDescription: text(500),
    priceAmount: { type: Number, required: true, min: 1, max: MAX_MINOR_UNITS, validate: integerOnly },
    currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
    rentPeriod: { type: String, enum: RENT_PERIODS },
    securityDepositAmount: money,
    maintenanceChargesAmount: money,
    ownerContactId: { type: Schema.Types.ObjectId, ref: 'Contact', default: null },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    images: {
      type: [imageSchema],
      default: [],
      validate: { validator: (v: unknown[]) => v.length <= MAX_PROPERTY_IMAGES, message: `At most ${MAX_PROPERTY_IMAGES} images` },
    },
    primaryImage: { type: Schema.Types.ObjectId, default: null }, // _id of an entry in images
    closedByDealId: { type: Schema.Types.ObjectId, ref: 'Deal', default: null }, // set while SOLD/RENTED/LEASED via a deal
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    searchKeywords: { type: [String], default: [], select: false },
  },
  { timestamps: true },
);

propertySchema.index({ organizationId: 1, deletedAt: 1, createdAt: -1 });
propertySchema.index({ organizationId: 1, propertyStatus: 1 });
propertySchema.index({ organizationId: 1, propertyType: 1 });
propertySchema.index({ organizationId: 1, listingType: 1 });
propertySchema.index({ organizationId: 1, assignedTo: 1 });
propertySchema.index({ organizationId: 1, city: 1 });
propertySchema.index({ organizationId: 1, priceAmount: 1 });
propertySchema.index({ organizationId: 1, createdAt: -1 });
propertySchema.index({ organizationId: 1, ownerContactId: 1 });
propertySchema.index({ organizationId: 1, searchKeywords: 1 });
// No 2dsphere index: nothing queries by distance yet. Add one when "near me" search is built.

export type PropertyDoc = HydratedDocument<InferSchemaType<typeof propertySchema>>;
export const Property = model('Property', propertySchema);