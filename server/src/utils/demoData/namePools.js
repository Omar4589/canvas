// Synthetic identity pools + deterministic PRNG for seedDemoOrg.js.
// Everything here is fabricated — no real voter data is ever sourced.

// mulberry32: tiny seeded PRNG so the demo dataset is identical on every run
// (same voters, same addresses, same staged history shape).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    // integer in [min, max] inclusive
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    // pick by [value, weight] pairs
    weighted(pairs) {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let roll = next() * total;
      for (const [value, w] of pairs) {
        roll -= w;
        if (roll <= 0) return value;
      }
      return pairs[pairs.length - 1][0];
    },
  };
}

export const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Karen', 'Charles', 'Sarah', 'Christopher', 'Lisa', 'Daniel', 'Nancy',
  'Matthew', 'Sandra', 'Anthony', 'Betty', 'Mark', 'Ashley', 'Donald', 'Emily',
  'Steven', 'Kimberly', 'Andrew', 'Margaret', 'Paul', 'Donna', 'Joshua', 'Michelle',
  'Kenneth', 'Carol', 'Kevin', 'Amanda', 'Brian', 'Melissa', 'Timothy', 'Deborah',
  'Ronald', 'Stephanie', 'George', 'Rebecca', 'Jason', 'Sharon', 'Edward', 'Laura',
  'Jeffrey', 'Cynthia', 'Ryan', 'Dorothy', 'Jacob', 'Amy', 'Nicholas', 'Kathleen',
  'Gary', 'Angela', 'Eric', 'Shirley', 'Jonathan', 'Emma', 'Stephen', 'Brenda',
  'Larry', 'Pamela', 'Justin', 'Nicole', 'Scott', 'Anna', 'Brandon', 'Samantha',
  'Benjamin', 'Katherine', 'Samuel', 'Christine', 'Gregory', 'Debra', 'Alexander', 'Rachel',
  'Patrick', 'Carolyn', 'Frank', 'Janet', 'Raymond', 'Maria', 'Jack', 'Olivia',
  'Dennis', 'Heather', 'Jerry', 'Helen', 'Tyler', 'Catherine', 'Aaron', 'Diane',
  'Jose', 'Julie', 'Adam', 'Victoria', 'Nathan', 'Joyce', 'Henry', 'Lauren',
  'Zachary', 'Kelly', 'Douglas', 'Christina', 'Peter', 'Ruth', 'Kyle', 'Joan',
  'Noah', 'Virginia', 'Ethan', 'Judith', 'Jeremy', 'Evelyn', 'Walter', 'Hannah',
  'Christian', 'Andrea', 'Keith', 'Megan', 'Roger', 'Cheryl', 'Terry', 'Jacqueline',
  'Austin', 'Madison', 'Sean', 'Teresa', 'Gerald', 'Abigail', 'Carl', 'Sophia',
  'Harold', 'Martha', 'Dylan', 'Sara', 'Arthur', 'Gloria', 'Lawrence', 'Janice',
  'Jordan', 'Kathryn', 'Jesse', 'Ann', 'Bryan', 'Isabella', 'Billy', 'Judy',
  'Bruce', 'Charlotte', 'Gabriel', 'Julia', 'Joe', 'Grace', 'Logan', 'Amber',
  'Alan', 'Alice', 'Juan', 'Jean', 'Albert', 'Denise', 'Willie', 'Frances',
  'Elijah', 'Danielle', 'Wayne', 'Marilyn', 'Randy', 'Natalie', 'Vincent', 'Beverly',
  'Mason', 'Diana', 'Roy', 'Brittany', 'Ralph', 'Theresa', 'Bobby', 'Kayla',
  'Russell', 'Alexis', 'Bradley', 'Doris', 'Philip', 'Lori', 'Eugene', 'Tiffany',
];

export const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
  'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
  'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young',
  'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
  'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker',
  'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris', 'Morales', 'Murphy',
  'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper', 'Peterson', 'Bailey',
  'Reed', 'Kelly', 'Howard', 'Ramos', 'Kim', 'Cox', 'Ward', 'Richardson',
  'Watson', 'Brooks', 'Chavez', 'Wood', 'James', 'Bennett', 'Gray', 'Mendoza',
  'Ruiz', 'Hughes', 'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel', 'Myers',
  'Long', 'Ross', 'Foster', 'Jimenez', 'Powell', 'Jenkins', 'Perry', 'Russell',
  'Sullivan', 'Bell', 'Coleman', 'Butler', 'Henderson', 'Barnes', 'Gonzales', 'Fisher',
  'Vasquez', 'Simmons', 'Romero', 'Jordan', 'Patterson', 'Alexander', 'Hamilton', 'Graham',
  'Reynolds', 'Griffin', 'Wallace', 'Moreno', 'West', 'Cole', 'Hayes', 'Bryant',
  'Herrera', 'Gibson', 'Ellis', 'Tran', 'Medina', 'Aguilar', 'Stevens', 'Murray',
  'Ford', 'Castro', 'Marshall', 'Owens', 'Harrison', 'Fernandez', 'McDonald', 'Woods',
  'Washington', 'Kennedy', 'Wells', 'Vargas', 'Henry', 'Chen', 'Freeman', 'Webb',
];

// Fictional branding — edit freely before running the seed. These names appear in
// screenshots, app-store reviewer walkthroughs, and live demos.
export const DEMO_ORG_NAME = 'Meridian Field Strategies';
export const DEMO_ORG_SLUG = 'meridian-field-demo';
export const DEMO_CAMPAIGN_NAME = 'Alvarez for State House';
export const DEMO_CANDIDATE = 'Elena Alvarez';

// Background canvasser display names (accounts get random passwords, never shared).
export const DEMO_CANVASSERS = [
  { firstName: 'Marcus', lastName: 'Webb' },
  { firstName: 'Priya', lastName: 'Natarajan' },
  { firstName: 'Danny', lastName: 'Ortega' },
  { firstName: 'Rachel', lastName: 'Kowalski' },
];
