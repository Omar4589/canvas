import { test } from 'node:test';
import assert from 'node:assert';
import { DEFAULT_EXPORT_OPTIONS, loadExportOptions, saveExportOptions } from './exportOptions.js';

// A fake store, because node has no localStorage — which is also the first thing this module has to
// survive (every accessor is wrapped, so a private window or blocked site data degrades to defaults
// rather than breaking the page).
const withStore = (impl, fn) => {
  const had = 'localStorage' in globalThis;
  const prev = globalThis.localStorage;
  globalThis.localStorage = impl;
  try {
    return fn();
  } finally {
    if (had) globalThis.localStorage = prev;
    else delete globalThis.localStorage;
  }
};

const memoryStore = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
  };
};

test('no stored value yields the defaults, and the default is OFF', () => {
  withStore(memoryStore(), () => {
    assert.deepStrictEqual(loadExportOptions('c1'), { ...DEFAULT_EXPORT_OPTIONS });
    assert.strictEqual(DEFAULT_EXPORT_OPTIONS.includeSurveyAnswers, false);
  });
});

test('a saved choice comes back, and only for its own campaign', () => {
  const store = memoryStore();
  withStore(store, () => {
    saveExportOptions('c1', { includeSurveyAnswers: true });
    assert.strictEqual(loadExportOptions('c1').includeSurveyAnswers, true);
    assert.strictEqual(loadExportOptions('c2').includeSurveyAnswers, false, 'another campaign is untouched');
  });
});

test('unticking is remembered too — this is last-choice-wins, not a one-way latch', () => {
  const store = memoryStore();
  withStore(store, () => {
    saveExportOptions('c1', { includeSurveyAnswers: true });
    saveExportOptions('c1', { includeSurveyAnswers: false });
    assert.strictEqual(loadExportOptions('c1').includeSurveyAnswers, false);
  });
});

test('an option added later is never undefined at render time', () => {
  const store = memoryStore();
  withStore(store, () => {
    store.setItem('exportOptions:c1', JSON.stringify({ someOldKey: true }));
    const opts = loadExportOptions('c1');
    assert.strictEqual(opts.includeSurveyAnswers, false, 'merged onto the defaults');
  });
});

test('corrupt JSON degrades to defaults instead of throwing at render', () => {
  const store = memoryStore();
  withStore(store, () => {
    store.setItem('exportOptions:c1', '{not json');
    assert.deepStrictEqual(loadExportOptions('c1'), { ...DEFAULT_EXPORT_OPTIONS });
  });
});

test('a blocked or full store never stops someone exporting', () => {
  const blocked = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  withStore(blocked, () => {
    assert.deepStrictEqual(loadExportOptions('c1'), { ...DEFAULT_EXPORT_OPTIONS });
    assert.doesNotThrow(() => saveExportOptions('c1', { includeSurveyAnswers: true }));
  });
});

test('no campaign id is a no-op in both directions', () => {
  const store = memoryStore();
  withStore(store, () => {
    saveExportOptions(undefined, { includeSurveyAnswers: true });
    assert.strictEqual(store.map.size, 0, 'nothing written under a bogus key');
    assert.deepStrictEqual(loadExportOptions(undefined), { ...DEFAULT_EXPORT_OPTIONS });
  });
});

test('with no localStorage at all (private mode, SSR) it still answers', () => {
  const had = 'localStorage' in globalThis;
  const prev = globalThis.localStorage;
  delete globalThis.localStorage;
  try {
    assert.deepStrictEqual(loadExportOptions('c1'), { ...DEFAULT_EXPORT_OPTIONS });
    assert.doesNotThrow(() => saveExportOptions('c1', { includeSurveyAnswers: true }));
  } finally {
    if (had) globalThis.localStorage = prev;
  }
});
