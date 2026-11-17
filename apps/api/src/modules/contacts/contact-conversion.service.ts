
import { CONVERTIBLE_LEAD_STATUSES } from '../../constants';
import { AppError } from '../../utils/app-error';
import type { RequestMeta } from '../../utils/request-meta';
import { runUnitOfWork } from '../../utils/transaction';
import { recordActivity } from '../activities/activity.service';
import { recordAudit } from '../audit/audit.service';
import { emitEntityEvent } from '../automations/automation.events';
import { Lead } from '../leads/lead.model';
import { getLead } from '../leads/lead.service';
import { OrganizationMember } from '../members/member.model';
import type { TenantContext } from '../members/member.service';
import { Contact, type ContactDoc } from './contact.model';
import { contactScope, serializeContact } from './contact.service';
import { deriveContactFields } from './contact.search';
import { fullName } from './contact.serializer';
import type { ConvertLeadInput } from './contact.validation';

const can = (t: TenantContext, p: string) => t.permissions.includes(p);

const isDuplicateKey = (
    e: unknown,
): e is { code: number; keyPattern?: Record<string, number> } =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: number }).code === 11000;

const summary = (c: {
    _id: unknown;
    firstName: string;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    contactType: string;
    status: string;
}) => ({
    _id: String(c._id),
    fullName: fullName(c),
    email: c.email ?? null,
    phone: c.phone ?? null,
    contactType: c.contactType,
    status: c.status,
});

/**
 * Converts a lead into a contact (or links it to an existing one the user chose after reviewing a duplicate).
 *
 * Safety against repeats and races:
 *  1. Fast path: a lead that already has convertedContactId is rejected (409 LEAD_ALREADY_CONVERTED).
 *  2. Authoritative guard: the lead is claimed atomically (update only if convertedContactId is still empty), and a
 *     unique partial index allows only one contact per linkedLeadId. A losing concurrent request fails and is rolled back.
 *  3. Everything runs in a MongoDB transaction when the deployment supports it. On a standalone server the same steps
 *     run with compensating cleanup (the contact is deleted if a later step fails). Limitation: on standalone MongoDB,
 *     a crash between steps could leave a contact without a lead link; the retry then reports a duplicate for review.
 */
export async function convertLeadToContact(
    tenant: TenantContext,
    userId: string,
    leadId: string,
    input: ConvertLeadInput,
    meta: RequestMeta,
) {
    const seeAllLeads = can(tenant, 'leads:read_all');

    const lead = await Lead.findOne({
        _id: leadId,
        organizationId: tenant.organizationId,
        deletedAt: null,
        ...(seeAllLeads ? {} : { assignedTo: userId }),
    } as never);

    if (!lead) {
        throw AppError.notFound('Lead not found');
    }

    const visibleContact = async (id: unknown) =>
        Contact.findOne({
            ...contactScope(tenant, userId),
            _id: id,
        } as never).lean();

    if (lead.convertedContactId) {
        const existing = await visibleContact(lead.convertedContactId);

        throw AppError.conflict(
            'This lead has already been converted to a contact.',
            'LEAD_ALREADY_CONVERTED',
            {
                contact: existing ? summary(existing) : null,
            },
        );
    }

    if (
        !(CONVERTIBLE_LEAD_STATUSES as readonly string[]).includes(
            lead.status,
        )
    ) {
        throw AppError.conflict(
            lead.status === 'LOST'
                ? 'Lost leads cannot be converted. Reopen the lead first.'
                : 'Only qualified leads can be converted. Move the lead to Qualified or later first.',
            'LEAD_NOT_CONVERTIBLE',
        );
    }

    // Link-to-existing (chosen after reviewing a duplicate) or duplicate detection.
    let target: ContactDoc | null = null;

    if (input.existingContactId) {
        target = await Contact.findOne({
            ...contactScope(tenant, userId),
            _id: input.existingContactId,
        } as never);

        if (!target) {
            throw AppError.notFound('Contact not found');
        }
    } else {
        const phones = [lead.phone, lead.alternatePhone].filter(
            (p): p is string => Boolean(p),
        );

        const or: Record<string, unknown>[] = [
            { phone: { $in: phones } },
            { alternatePhone: { $in: phones } },
        ];

        if (lead.email) {
            or.push({ email: lead.email });
        }

        // Matched org-wide so nobody can bypass the check, but only visible matches are described.
        const found = await Contact.find({
            organizationId: tenant.organizationId,
            deletedAt: null,
            $or: or,
        } as never)
            .select(
                'firstName lastName email phone alternatePhone contactType status assignedTo',
            )
            .limit(5)
            .lean();

        if (found.length > 0) {
            const visible = can(tenant, 'contacts:read_all')
                ? found
                : found.filter(
                      (c) => String(c.assignedTo) === userId,
                  );

            throw AppError.conflict(
                'A contact with the same email or phone already exists.',
                'CONTACT_DUPLICATE',
                {
                    matches: visible.map((c) => ({
                        ...summary(c),
                        matchedOn: [
                            ...(lead.email && c.email === lead.email
                                ? ['email']
                                : []),
                            ...(phones.includes(c.phone ?? '') ||
                            phones.includes(c.alternatePhone ?? '')
                                ? ['phone']
                                : []),
                        ],
                    })),
                    hiddenMatches: found.length - visible.length,
                },
            );
        }

        if (!can(tenant, 'contacts:create')) {
            throw AppError.forbidden(
                'You do not have permission to create contacts',
            );
        }
    }

    const leadName = fullName(lead);
    const now = new Date();

    const contact = await runUnitOfWork(async (uow) => {
        let contactDoc = target;

        if (!contactDoc) {
            let assignedTo: string | null = lead.assignedTo
                ? String(lead.assignedTo)
                : null;

            if (
                assignedTo &&
                !(await OrganizationMember.exists({
                    organizationId: tenant.organizationId,
                    userId: assignedTo,
                    status: 'ACTIVE',
                    invitationStatus: 'ACCEPTED',
                }))
            ) {
                assignedTo = null; // the lead's agent left the team
            }

            if (!assignedTo && !can(tenant, 'contacts:read_all')) {
                assignedTo = userId; // agents must still see what they create
            }

            const doc = {
                organizationId: tenant.organizationId,
                createdBy: userId,
                linkedLeadId: lead._id,
                assignedTo,
                firstName: lead.firstName,
                lastName: lead.lastName ?? '',
                email: lead.email ?? undefined,
                phone: lead.phone,
                alternatePhone: lead.alternatePhone ?? undefined,
                contactType: lead.leadType as ContactDoc['contactType'],
                status: 'ACTIVE' as const,
                tags: [],
                source: lead.leadSource,
                notes: lead.notes ?? undefined,
            };

            try {
                const [created] = await Contact.create(
                    [{ ...doc, ...deriveContactFields(doc) }],
                    { session: uow.session },
                );

                contactDoc = created!;

                uow.onRollback(() =>
                    Contact.deleteOne({ _id: created!._id }),
                );
            } catch (err) {
                if (
                    isDuplicateKey(err) &&
                    err.keyPattern?.linkedLeadId
                ) {
                    throw AppError.conflict(
                        'This lead was just converted by another request.',
                        'LEAD_ALREADY_CONVERTED',
                    );
                }

                if (
                    isDuplicateKey(err) &&
                    err.keyPattern?.email
                ) {
                    throw AppError.conflict(
                        'A contact with the same email already exists.',
                        'CONTACT_DUPLICATE',
                        { matches: [], hiddenMatches: 1 },
                    );
                }

                throw err;
            }
        }

        // Atomic claim: succeeds only while the lead is still unconverted.
        const claimed = await Lead.findOneAndUpdate(
            {
                _id: lead._id,
                organizationId: tenant.organizationId,
                deletedAt: null,
                convertedContactId: null,
            },
            {
                $set: {
                    convertedContactId: contactDoc._id,
                    convertedAt: now,
                },
            },
            { session: uow.session },
        );

        if (!claimed) {
            throw AppError.conflict(
                'This lead has already been converted to a contact.',
                'LEAD_ALREADY_CONVERTED',
            );
        }

        const contactName = fullName(contactDoc);

        await recordActivity(
            {
                organizationId: tenant.organizationId,
                userId,
                entityType: 'LEAD',
                entityId: lead._id,
                activityType: 'CONVERTED',
                description: target
                    ? `Linked to existing contact ${contactName}`
                    : `Converted to contact ${contactName}`,
                metadata: {
                    contactId: String(contactDoc._id),
                    linkedExisting: Boolean(target),
                },
            },
            uow.session,
        );

        await recordActivity(
            {
                organizationId: tenant.organizationId,
                userId,
                entityType: 'CONTACT',
                entityId: contactDoc._id,
                activityType: target ? 'UPDATE' : 'CREATED',
                description: target
                    ? `Linked to lead ${leadName}`
                    : `Contact created from lead ${leadName}`,
                metadata: {
                    leadId: String(lead._id),
                },
            },
            uow.session,
        );

        await recordAudit(
            {
                organizationId: tenant.organizationId,
                actorId: userId,
                action: 'lead.converted',
                resource: 'lead',
                resourceId: lead._id,
                after: {
                    contactId: String(contactDoc._id),
                    linkedExisting: Boolean(target),
                },
                meta,
            },
            uow.session,
        );

        if (!target) {
            await recordAudit(
                {
                    organizationId: tenant.organizationId,
                    actorId: userId,
                    action: 'contact.created',
                    resource: 'contact',
                    resourceId: contactDoc._id,
                    after: {
                        viaConversion: true,
                        leadId: String(lead._id),
                    },
                    meta,
                },
                uow.session,
            );
        }

        return contactDoc;
    });

    // Emit only after the conversion transaction has committed.
    await emitEntityEvent({
        type: 'LEAD_CONVERTED',
        entityType: 'LEAD',
        entityId: lead._id,
        organizationId: tenant.organizationId,
        actorId: userId,
        key: 'once',
    });

    // Linking an existing contact is not a contact creation event.
    if (!target) {
        await emitEntityEvent({
            type: 'CONTACT_CREATED',
            entityType: 'CONTACT',
            entityId: contact._id,
            organizationId: tenant.organizationId,
            actorId: userId,
        });
    }

    return {
        lead: await getLead(tenant, userId, leadId),
        contact: await serializeContact(contact),
        linkedExisting: Boolean(target),
    };
}
