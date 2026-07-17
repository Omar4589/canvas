import { Organization } from '../../models/Organization.js';
import { OrgDeletionRequest } from '../../models/OrgDeletionRequest.js';
import { DELETE_REQUEST_SLA_DAYS } from './triggers.js';

// The intake behind "a customer may request deletion of their data." Until now the model and the
// 30-day executor existed but NOTHING created a request — the promise had a consumer and no producer,
// so it was unbackable. This is the producer: it turns a request into a dated, cancellable, tracked
// record the sweep acts on. It does NOT delete anything itself; it schedules.

const DAY = 86_400_000;

export class DeletionRequestError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Schedule an organization's deletion for `now + SLA`. Cancellable until it fires. One open request per
 * org at a time — a second call returns the existing one rather than stacking a second clock.
 */
export async function requestOrgDeletion({ organizationId, requestedBy = null, requestedByEmail = null, note = '', slaDays } = {}) {
  const org = await Organization.findById(organizationId, 'name slug').lean();
  if (!org) throw new DeletionRequestError('Organization not found', 404, 'ORG_NOT_FOUND');

  const existing = await OrgDeletionRequest.findOne({ organizationId, status: 'scheduled' });
  if (existing) return { request: existing, org, alreadyScheduled: true };

  const days = Number.isFinite(slaDays) ? slaDays : DELETE_REQUEST_SLA_DAYS;
  const scheduledFor = new Date(Date.now() + days * DAY);
  const request = await OrgDeletionRequest.create({
    organizationId,
    requestedBy,
    requestedByEmail: requestedByEmail || null,
    note: String(note || '').trim(),
    scheduledFor,
    status: 'scheduled',
  });
  return { request, org, alreadyScheduled: false };
}

/** Cancel a scheduled deletion before it fires. Idempotent-ish: a non-scheduled request 409s. */
export async function cancelOrgDeletion({ requestId, cancelledBy = null } = {}) {
  const req = await OrgDeletionRequest.findById(requestId);
  if (!req) throw new DeletionRequestError('Deletion request not found', 404, 'NOT_FOUND');
  if (req.status !== 'scheduled') {
    throw new DeletionRequestError(`Request is already ${req.status}`, 409, 'NOT_SCHEDULED');
  }
  req.status = 'cancelled';
  req.cancelledAt = new Date();
  req.cancelledBy = cancelledBy;
  await req.save();
  return req;
}

/** Open + recently-resolved requests, for the platform ops surface. */
export async function listDeletionRequests({ status = null, skip = 0, limit = 100 } = {}) {
  const filter = status ? { status } : {};
  const [total, rows] = await Promise.all([
    OrgDeletionRequest.countDocuments(filter),
    OrgDeletionRequest.find(filter)
      .sort({ status: 1, scheduledFor: 1 })
      .skip(Math.max(skip, 0))
      .limit(limit)
      .populate('organizationId', 'name slug')
      .lean(),
  ]);
  return { rows, total };
}
