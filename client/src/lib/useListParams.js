import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { nextParams, readParams, sameParams } from './listParams.js';

// [params, setParams] over the address for a list page (lib/listParams.js has the rules). `defaults`
// must be a module constant: it keys the setter's memo. Each event writes ONE patch — react-router's
// setter reads the address as of the last render, so two writes in one tick would drop the first.
export const useListParams = (defaults) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = readParams(searchParams, defaults);
  const setParams = useCallback(
    (patch) => {
      const next = nextParams(searchParams, patch, defaults);
      if (!sameParams(next, searchParams)) setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams, defaults]
  );
  return [params, setParams];
};
