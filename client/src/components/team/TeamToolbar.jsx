import { Input, Select, IconSearch } from '../ui/index.js';

// The Team page's search, crew filter and role filter (docs/PROPOSAL_PEOPLE_PAGES.md §E.3). The crew
// filter lists every crew on this roster with a count, and No crew; each count is what picking it
// would show, under the quick filter, the search and the role. A crew picked by a link that the roster
// no longer has still shows, with 0, so the select never reads as something else.
const TeamToolbar = ({ search, onSearch, crew, crews, noCrewCount, onCrew, role, onRole }) => {
  const known = crew === 'all' || crew === 'none' || crews.some((c) => c.id === crew);
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="min-w-[220px] flex-1">
        <Input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name or email…"
          aria-label="Search this team by name or email"
          leadingIcon={<IconSearch size={16} />}
        />
      </div>
      <Select value={crew} onChange={(e) => onCrew(e.target.value)} aria-label="Crew">
        <option value="all">All crews</option>
        {crews.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.count.toLocaleString()})
          </option>
        ))}
        {!known && <option value={crew}>That crew (0)</option>}
        <option value="none">No crew ({noCrewCount.toLocaleString()})</option>
      </Select>
      <Select value={role} onChange={(e) => onRole(e.target.value)} aria-label="Role">
        <option value="all">Everyone</option>
        <option value="canvasser">Canvassers</option>
        <option value="lead">Team leads</option>
        <option value="admin">Admins</option>
      </Select>
    </div>
  );
};

export default TeamToolbar;
