import { useEffect, useRef, useState } from 'react';
import { mergeRun } from './runInChunks.js';

// The lifecycle every Team page bulk dialog shares (docs/PROPOSAL_PEOPLE_PAGES.md §E.5), around
// lib/runInChunks.js: one run at a time, its progress, Stop (no new request after the one out), and the
// summary, which Retry failed and Continue update in place. Closing the dialog aborts what is out.
// `onFinally` (the caches a run touches) runs once per run, whatever happened.
//
// run(ids, exec): exec({ signal, fetchSignal, onProgress }) → a runInChunks result. `signal` is Stop's,
// for runInChunks; `fetchSignal` is the dialog's, for the requests themselves.
export const useChunkRun = ({ onFinally } = {}) => {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);
  const stopRef = useRef(null);
  const closedRef = useRef(null);
  const finallyRef = useRef(onFinally);
  useEffect(() => {
    finallyRef.current = onFinally;
  });

  useEffect(() => {
    const closed = new AbortController();
    closedRef.current = closed;
    return () => {
      closed.abort();
      stopRef.current?.abort();
    };
  }, []);

  const run = async (ids, exec) => {
    const stop = new AbortController();
    stopRef.current = stop;
    setRunning(true);
    setProgress({ settled: 0, total: ids.length });
    try {
      const result = await exec({ signal: stop.signal, fetchSignal: closedRef.current?.signal, onProgress: setProgress });
      setSummary((prev) => mergeRun(prev, ids, result));
      return result;
    } finally {
      stopRef.current = null;
      setRunning(false);
      finallyRef.current?.();
    }
  };

  return { running, progress, summary, run, stop: () => stopRef.current?.abort() };
};
