import { FIELD_CLS } from './ui';

// The one survey-override picker for walk lists (efforts), shared by the campaign
// Survey page and the Walk Lists page so the archived-hiding rule lives in one place:
// archived surveys are hidden EXCEPT the one currently selected (so an effort pinned
// to a now-archived survey shows it instead of silently reading "Campaign default").
// value: effort.surveyTemplateId | '' — onChange receives the id string or null.
export default function WalkListSurveySelect({ value, surveys = [], onChange, disabled = false, className }) {
  const current = value ? String(value) : '';
  const options = surveys.filter((s) => !s.archivedAt || String(s._id) === current);
  const known = current && options.some((s) => String(s._id) === current);
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      className={className || FIELD_CLS}
    >
      <option value="">Campaign default</option>
      {options.map((s) => (
        <option key={s._id} value={String(s._id)}>
          {s.name} (v{s.version || 1}{s.archivedAt ? ' · archived' : ''})
        </option>
      ))}
      {current && !known && <option value={current}>Unknown survey</option>}
    </select>
  );
}
