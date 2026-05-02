import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/:activityId', async (req, res, next) => {
  try {
    const { activityId } = req.params;
    if (!mongoose.isValidObjectId(activityId)) {
      return res.status(400).json({ error: 'Invalid activityId' });
    }
    const activity = await CanvassActivity.findById(activityId)
      .populate('userId', 'firstName lastName email')
      .populate('householdId', 'addressLine1 addressLine2 city state zipCode')
      .populate('voterId', 'fullName party')
      .lean();
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    let surveyResponse = null;
    if (activity.actionType === 'survey_submitted' && activity.voterId) {
      // Per-voter overwrite means at most one SurveyResponse per voter.
      surveyResponse = await SurveyResponse.findOne({ voterId: activity.voterId._id })
        .select('answers note submittedAt surveyTemplateVersion')
        .lean();
    }

    res.json({
      activity: {
        id: String(activity._id),
        actionType: activity.actionType,
        timestamp: activity.timestamp,
        note: activity.note || null,
        location: activity.location,
        distanceFromHouseMeters: activity.distanceFromHouseMeters,
        wasOfflineSubmission: activity.wasOfflineSubmission,
      },
      canvasser: activity.userId
        ? {
            id: String(activity.userId._id),
            firstName: activity.userId.firstName,
            lastName: activity.userId.lastName,
            email: activity.userId.email,
          }
        : null,
      household: activity.householdId
        ? {
            id: String(activity.householdId._id),
            addressLine1: activity.householdId.addressLine1,
            addressLine2: activity.householdId.addressLine2 || null,
            city: activity.householdId.city,
            state: activity.householdId.state,
            zipCode: activity.householdId.zipCode,
          }
        : null,
      voter: activity.voterId
        ? {
            id: String(activity.voterId._id),
            fullName: activity.voterId.fullName,
            party: activity.voterId.party || null,
          }
        : null,
      surveyResponse: surveyResponse
        ? {
            id: String(surveyResponse._id),
            submittedAt: surveyResponse.submittedAt,
            surveyTemplateVersion: surveyResponse.surveyTemplateVersion,
            note: surveyResponse.note || null,
            answers: surveyResponse.answers || [],
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
