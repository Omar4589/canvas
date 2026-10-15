import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import babelParser from '@babel/parser';

// The rule behind the Books-map gray screen (docs/PROPOSAL_BOOKS_MAP_GRAY_SCREEN.md,
// docs/PROPOSAL_ERROR_RECOVERY.md §B10): a map element's setting must never DISAPPEAR. When a prop on
// a Mapbox element goes from a value to nothing, React sends null to the native side, and on Android
// the map's setters read it as a string, number or object before checking for null — the React host is
// destroyed and the phone shows a flat gray screen. Mount or unmount a whole element instead.
//
// So on any <Mapbox.*> element this fails:
//   · a value that is `a && b` (it yields `a` when `a` is falsy), a void, an optional chain (a?.b, f?.()),
//     or `a || b` / `a ?? b` whose fallback `b` is itself one of these — `zoom ?? 14` is fine;
//   · a conditional with a branch that is undefined, null or one of the above (nested conditionals too) —
//     a conditional between two defined values is fine; the last value of a comma expression likewise;
//   · undefined or null as the value (a valueless attribute like `zoomEnabled` is fine);
//   · a spread, unless the tag carries a comment `native-props-ok: <some>.test.js` naming a test in
//     mobile/lib that pins every key the spread can produce (a block comment between attributes, or a
//     line comment inside a multi-line tag — `{/* */}` is a syntax error there).
// Nested values (inside style={{…}} or a filter array) are not checked, and it can't see a variable
// that becomes undefined — the one deliberate case is the staging native-failure row
// (components/ErrorRecoveryTests.jsx).
//
// Every file under app/ and components/ that uses the map library must import it as
// `import Mapbox from '@rnmapbox/maps'`: no require() or import() of it or of lib/mapbox.js, no named or
// namespace import, and no re-export of it (`export … from '@rnmapbox/maps'`, `export { default } from
// '…/lib/mapbox'`, or exporting the `Mapbox` binding itself). lib/mapbox.js's default, if imported, is also
// named `Mapbox`. An alias made with `const` or `=` — `const M = Mapbox`, `const { ShapeSource } = Mapbox`,
// `S = Mapbox.ShapeSource` (or `Mapbox?.ShapeSource`) — is followed, and the elements written with it are
// checked too. Aliases are matched by name, not scope, so a different component that reuses an alias's
// name is checked as well (rename it). Anything subtler — an alias built inside an object, array or
// conditional, or a component passed in as a parameter — is not seen.
//
// Needs @babel/parser: a root devDependency (CI installs it), and mobile/node_modules locally.

const LIB = fileURLToPath(new URL('.', import.meta.url));
const MOBILE = fileURLToPath(new URL('..', import.meta.url));
const SCANNED = ['app', 'components'];
const MARKER = /native-props-ok:\s*([\w.-]+\.test\.js)/;

const parse = (source) => babelParser.parse(source, { sourceType: 'module', plugins: ['jsx'] });

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments']);
const walk = (node, visit) => {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) for (const c of child) walk(c, visit);
    else if (child && typeof child.type === 'string') walk(child, visit);
  }
};

const MAP_LIBRARY = '@rnmapbox/maps';
const isLibWrapper = (from) => /(^|\/)lib\/mapbox(\.js)?$/.test(from);

// The identifier at the root of a.b.c (or a?.b.c).
const rootName = (expr) => {
  let n = expr;
  while (n && (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression')) n = n.object;
  return n?.type === 'Identifier' ? n.name : null;
};

// Local names that are the map library under another name, in source order: namespaces (`Mapbox`,
// `const M = Mapbox`) and components (`const { ShapeSource } = Mapbox`, `const S = Mapbox.ShapeSource`).
const isMember = (expr) => expr.type === 'MemberExpression' || expr.type === 'OptionalMemberExpression';
const collectAliases = (program) => {
  const namespaces = new Set(['Mapbox']);
  const components = new Set();
  walk(program, (node) => {
    let id;
    let init;
    if (node.type === 'VariableDeclarator' && node.init) ({ id, init } = node);
    else if (node.type === 'AssignmentExpression' && node.operator === '=') ({ left: id, right: init } = node);
    else return;
    if (id.type === 'Identifier') {
      if (init.type === 'Identifier' && namespaces.has(init.name)) namespaces.add(id.name);
      else if (isMember(init) && namespaces.has(rootName(init))) components.add(id.name);
    } else if (id.type === 'ObjectPattern' && init.type === 'Identifier' && namespaces.has(init.name)) {
      for (const prop of id.properties) {
        if (prop.type !== 'ObjectProperty') continue;
        const local = prop.value.type === 'AssignmentPattern' ? prop.value.left : prop.value;
        if (local.type === 'Identifier') components.add(local.name);
      }
    }
  });
  return { namespaces, components };
};

// <Mapbox.X> (and <Mapbox.X.Y> should one ever appear), the same through an alias, or <X> for a
// component alias. Null for anything else.
const mapTag = (name, { namespaces, components }) => {
  if (name?.type === 'JSXIdentifier') return components.has(name.name) ? name.name : null;
  if (name?.type !== 'JSXMemberExpression') return null;
  let root = name;
  while (root.type === 'JSXMemberExpression') root = root.object;
  if (root.type !== 'JSXIdentifier' || !(namespaces.has(root.name) || components.has(root.name))) return null;
  const parts = [];
  for (let n = name; n.type === 'JSXMemberExpression'; n = n.object) parts.unshift(n.property.name);
  return `${root.name}.${parts.join('.')}`;
};

const isOptionalChain = (expr) => expr.type === 'OptionalMemberExpression' || expr.type === 'OptionalCallExpression';

// `a && b` yields `a` when `a` is falsy; `a || b` and `a ?? b` can only vanish through their fallback.
const logicalCanVanish = (expr) => expr.operator === '&&' || canVanish(expr.right);

const canVanish = (expr) =>
  (expr.type === 'Identifier' && expr.name === 'undefined') ||
  expr.type === 'NullLiteral' ||
  (expr.type === 'UnaryExpression' && expr.operator === 'void') ||
  (expr.type === 'LogicalExpression' && logicalCanVanish(expr)) ||
  isOptionalChain(expr) ||
  (expr.type === 'SequenceExpression' && canVanish(expr.expressions[expr.expressions.length - 1])) ||
  (expr.type === 'ConditionalExpression' && (canVanish(expr.consequent) || canVanish(expr.alternate)));

const attributeProblem = (attr) => {
  if (attr.value === null) return null; // valueless: `zoomEnabled`
  if (attr.value.type !== 'JSXExpressionContainer') return null; // a string literal
  const expr = attr.value.expression;
  if (expr.type === 'JSXEmptyExpression') return null;
  if (expr.type === 'LogicalExpression') {
    return logicalCanVanish(expr) ? `a logical expression (${expr.operator}) that can be undefined or null` : null;
  }
  if (expr.type === 'UnaryExpression' && expr.operator === 'void') return 'a void expression';
  if (isOptionalChain(expr)) return 'an optional chain (?.)';
  if (expr.type === 'Identifier' && expr.name === 'undefined') return 'undefined';
  if (expr.type === 'NullLiteral') return 'null';
  if (expr.type === 'SequenceExpression' && canVanish(expr)) return 'a comma expression that can be undefined or null';
  if (expr.type === 'ConditionalExpression' && canVanish(expr)) return 'a conditional that can be undefined or null';
  return null;
};

const findViolations = (source, { file = 'fixture.jsx', testExists = (name) => existsSync(join(LIB, name)) } = {}) => {
  const ast = parse(source);
  const comments = ast.comments || [];
  const aliases = collectAliases(ast.program);
  const violations = [];
  let elements = 0;
  walk(ast.program, (node) => {
    if (node.type === 'ImportDeclaration') {
      const from = node.source.value;
      const line = node.loc.start.line;
      if (from === MAP_LIBRARY) {
        const ok =
          node.specifiers.length === 1 &&
          node.specifiers[0].type === 'ImportDefaultSpecifier' &&
          node.specifiers[0].local.name === 'Mapbox';
        if (!ok) violations.push(`${file}:${line} imports @rnmapbox/maps other than as \`import Mapbox from '@rnmapbox/maps'\``);
      } else if (isLibWrapper(from)) {
        for (const spec of node.specifiers) {
          const isDefault =
            spec.type === 'ImportDefaultSpecifier' ||
            (spec.type === 'ImportSpecifier' && (spec.imported.name ?? spec.imported.value) === 'default');
          if (spec.type === 'ImportNamespaceSpecifier') violations.push(`${file}:${line} imports lib/mapbox as a namespace`);
          else if (isDefault && spec.local.name !== 'Mapbox') violations.push(`${file}:${line} imports lib/mapbox's default as ${spec.local.name}, not Mapbox`);
        }
      }
      return;
    }
    if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'ExportDefaultDeclaration') {
      const line = node.loc.start.line;
      const from = node.source?.value;
      const exportsBinding =
        (node.type === 'ExportDefaultDeclaration' && node.declaration?.type === 'Identifier' && aliases.namespaces.has(node.declaration.name)) ||
        (node.type === 'ExportNamedDeclaration' && !from && node.specifiers.some((sp) => aliases.namespaces.has(sp.local?.name)));
      if (from === MAP_LIBRARY || exportsBinding) {
        violations.push(`${file}:${line} re-exports the map library — import it as Mapbox where it is used`);
      } else if (from && isLibWrapper(from) && (node.type === 'ExportAllDeclaration' || node.specifiers.some((sp) => (sp.local?.name ?? sp.local?.value) === 'default'))) {
        violations.push(`${file}:${line} re-exports lib/mapbox's default — import it as Mapbox where it is used`);
      }
      return;
    }
    if (node.type === 'CallExpression') {
      const arg = node.arguments[0];
      const loads = node.callee.type === 'Import' || (node.callee.type === 'Identifier' && node.callee.name === 'require');
      if (loads && arg?.type === 'StringLiteral' && (arg.value === MAP_LIBRARY || isLibWrapper(arg.value))) {
        const how = node.callee.type === 'Import' ? 'import()' : 'require';
        violations.push(
          arg.value === MAP_LIBRARY
            ? `${file}:${node.loc.start.line} loads @rnmapbox/maps with ${how} — use \`import Mapbox from '@rnmapbox/maps'\``
            : `${file}:${node.loc.start.line} loads lib/mapbox with ${how} — import it (its default as Mapbox)`
        );
      }
      return;
    }
    if (node.type !== 'JSXOpeningElement') return;
    const tag = mapTag(node.name, aliases);
    if (!tag) return;
    elements += 1;
    for (const attr of node.attributes) {
      const line = attr.loc.start.line;
      if (attr.type === 'JSXSpreadAttribute') {
        const marker = comments
          .filter((c) => c.start >= node.start && c.end <= node.end)
          .map((c) => MARKER.exec(c.value))
          .find(Boolean);
        if (!marker) violations.push(`${file}:${line} <${tag}> spreads props with no native-props-ok marker`);
        else if (!testExists(marker[1])) violations.push(`${file}:${line} <${tag}>'s marker names ${marker[1]}, which isn't in mobile/lib`);
        continue;
      }
      const problem = attributeProblem(attr);
      if (problem) violations.push(`${file}:${line} <${tag}> ${attr.name.name}= is ${problem}`);
    }
  });
  return { violations, elements };
};

const sourceFiles = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.jsx?$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) out.push(path);
  }
  return out;
};

test('no map element in the app is given a setting that can disappear', () => {
  const files = SCANNED.flatMap((d) => sourceFiles(join(MOBILE, d)));
  assert.ok(files.length > 50, `scanned only ${files.length} files`);
  let elements = 0;
  const violations = [];
  for (const path of files) {
    const result = findViolations(readFileSync(path, 'utf8'), { file: relative(MOBILE, path) });
    elements += result.elements;
    violations.push(...result.violations);
  }
  // The scan must actually see the maps (no pinned count: the staging test rows added some).
  assert.ok(elements > 50, `found only ${elements} map elements — is the scan still seeing them?`);
  assert.deepEqual(violations, []);
});

// --- The rule is discriminative: it catches the real bug and the patterns like it, and passes the
// --- shapes the app uses.

test('flags the Books-map door-dots source that grayed the screen (f906408)', () => {
  const prefix = `import Mapbox from '@rnmapbox/maps';
const X = () => (
            <Mapbox.ShapeSource
              id="door-dots"
              {...(doorsQ.data
                ? { url: doorsQ.data }
                : { shape: { type: 'FeatureCollection', features: [] } })}
            >
              <Mapbox.CircleLayer id="door-dot" filter={doorDotFilter} />
            </Mapbox.ShapeSource>
);`;
  const { violations, elements } = findViolations(prefix);
  assert.equal(elements, 2);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /ShapeSource> spreads props with no native-props-ok marker/);
});

test('flags each pattern that can send null', () => {
  const cases = {
    'shape={x ? y : undefined}': /conditional/,
    'shape={x ? y : null}': /conditional/,
    'shape={x ? y : (z ? w : undefined)}': /conditional/,
    'shape={x ? (a && b) : y}': /conditional/,
    'url={ready && url}': /logical/,
    'minZoomLevel={zoom ?? undefined}': /logical/,
    'url={a || (b && c)}': /logical/,
    'shape={(prepare(), undefined)}': /comma/,
    'filter={void 0}': /void/,
    'filter={undefined}': /undefined/,
    'filter={null}': /null/,
    'url={doors?.url}': /optional chain/,
    'shape={build?.()}': /optional chain/,
    'shape={x ? doors?.shape : empty}': /conditional/,
  };
  for (const [attr, why] of Object.entries(cases)) {
    const { violations } = findViolations(`import Mapbox from '@rnmapbox/maps';\nconst X = () => <Mapbox.ShapeSource id="s" ${attr} />;`);
    assert.equal(violations.length, 1, attr);
    assert.match(violations[0], why, attr);
  }
});

test('passes what the app does: whole elements mounted conditionally, defined values, valueless props', () => {
  const ok = `import Mapbox from '@rnmapbox/maps';
const X = ({ data, grey, zoom }) => (
  <Mapbox.MapView style={{ flex: 1 }} zoomEnabled scaleBarEnabled={false}>
    {data ? (
      <Mapbox.ShapeSource id="dots" url={data}>
        <Mapbox.CircleLayer id="dot" style={{ circleOpacity: grey ? 0.2 : undefined }} />
      </Mapbox.ShapeSource>
    ) : (
      <Mapbox.ShapeSource id="dots" shape={{ type: 'FeatureCollection', features: [] }} />
    )}
    {grey && <Mapbox.Images images={{}} />}
    <Mapbox.Camera zoomLevel={zoom ?? 14} animationMode={grey ? 'none' : 'flyTo'} />
    <Mapbox.ShapeSource id="fallback" shape={data || EMPTY_COLLECTION} />
  </Mapbox.MapView>
);`;
  const { violations, elements } = findViolations(ok);
  assert.equal(elements, 7);
  assert.deepEqual(violations, []);
});

test('a marked spread passes only when it names a test that exists', () => {
  // The GPS plan's puck (PROPOSAL_GPS_UPGRADES.md §F.1), marked.
  const puck = (name) => `import Mapbox from '@rnmapbox/maps';
const P = ({ grey }) => (
  <Mapbox.LocationPuck visible pulsing={grey ? PUCK_PULSING_OFF : PUCK_PULSING}
    scale={PUCK_SCALE} /* native-props-ok: ${name} */ {...puckImageProps(Platform.OS, grey)} />
);`;
  const exists = (n) => n === 'puckLook.test.js';
  assert.deepEqual(findViolations(puck('puckLook.test.js'), { testExists: exists }).violations, []);
  const missing = findViolations(puck('nope.test.js'), { testExists: exists }).violations;
  assert.equal(missing.length, 1);
  assert.match(missing[0], /names nope\.test\.js/);
  // A line comment inside a multi-line tag counts too; a comment outside the tag doesn't.
  const lineMarked = `import Mapbox from '@rnmapbox/maps';
const P = (p) => (
  <Mapbox.LocationPuck
    // native-props-ok: puckLook.test.js
    {...p}
  />
);`;
  assert.deepEqual(findViolations(lineMarked, { testExists: exists }).violations, []);
  const outside = `import Mapbox from '@rnmapbox/maps';
// native-props-ok: puckLook.test.js
const P = (p) => <Mapbox.LocationPuck {...p} />;`;
  assert.equal(findViolations(outside, { testExists: exists }).violations.length, 1);
});

test('the map library must be imported as Mapbox, so no element escapes the check', () => {
  for (const line of [
    "import { ShapeSource } from '@rnmapbox/maps';",
    "import MB from '@rnmapbox/maps';",
    "import * as MB from '@rnmapbox/maps';",
    "import Mapbox, { Camera } from '@rnmapbox/maps';",
    "import MB from '../lib/mapbox';",
    "import { default as MB } from '../lib/mapbox';",
    "import * as MB from '../../lib/mapbox';",
    "const MB = require('@rnmapbox/maps');",
    "const MB = import('@rnmapbox/maps');",
    "export { ShapeSource } from '@rnmapbox/maps';",
    "export * from '@rnmapbox/maps';",
    "export { default } from '../lib/mapbox';",
    "const M = require('../lib/mapbox').default;",
  ]) {
    assert.equal(findViolations(`${line}\nconst X = 1;`).violations.length, 1, line);
  }
  for (const line of ['export default Mapbox;', 'export { Mapbox };', 'const M = Mapbox;\nexport { M };']) {
    assert.equal(findViolations(`import Mapbox from '@rnmapbox/maps';\n${line}`).violations.length, 1, line);
  }
  assert.deepEqual(
    findViolations("import Mapbox from '@rnmapbox/maps';\nimport { initMapbox } from '../lib/mapbox';").violations,
    []
  );
});

test('elements written through a const alias of the library are checked too', () => {
  const head = "import Mapbox from '@rnmapbox/maps';\n";
  const cases = [
    'const MB = Mapbox;\nconst X = ({ a, b }) => <MB.ShapeSource id="s" url={a && b} />;',
    'const { ShapeSource } = Mapbox;\nconst X = ({ x, y }) => <ShapeSource id="s" shape={x ? y : undefined} />;',
    'const { ShapeSource: Source } = Mapbox;\nconst X = ({ d }) => <Source id="s" url={d?.url} />;',
    'const Source = Mapbox.ShapeSource;\nconst X = (p) => <Source id="s" {...p} />;',
    'const Source = Mapbox?.ShapeSource;\nconst X = ({ d }) => <Source id="s" url={d && d.url} />;',
    'let Source;\nSource = Mapbox.ShapeSource;\nconst X = ({ x, y }) => <Source id="s" shape={x ? y : null} />;',
  ];
  for (const body of cases) {
    const { violations, elements } = findViolations(head + body);
    assert.equal(elements, 1, body);
    assert.equal(violations.length, 1, body);
  }
  // A clean element through an alias passes, and an unrelated component of the same shape is ignored.
  const clean = findViolations(`${head}const { Camera } = Mapbox;\nconst X = ({ z }) => (<><Camera zoomLevel={z} /><Other url={a && b} /></>);`);
  assert.equal(clean.elements, 1);
  assert.deepEqual(clean.violations, []);
});
