import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: {
      type: String,
      enum: ['single_choice', 'multiple_choice', 'text'],
      required: true,
    },
    options: { type: [String], default: [] },
    required: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const surveyTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    isActive: { type: Boolean, default: false, index: true },
    version: { type: Number, default: 1 },
    questions: { type: [questionSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export const SurveyTemplate = mongoose.model('SurveyTemplate', surveyTemplateSchema);
