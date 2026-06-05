import { lazy, Suspense } from 'react';
import Skeleton from '../ui/Skeleton.jsx';

// Lazy-load recharts so it stays out of the main bundle (only pulled in where a
// chart actually renders).
const SparklineLazy = lazy(() => import('./Sparkline.jsx'));
const MiniBarsLazy = lazy(() => import('./MiniBars.jsx'));

export function Sparkline(props) {
  return (
    <Suspense fallback={<Skeleton className="h-10 w-full" />}>
      <SparklineLazy {...props} />
    </Suspense>
  );
}

export function MiniBars(props) {
  return (
    <Suspense fallback={<Skeleton className="h-7 w-full" />}>
      <MiniBarsLazy {...props} />
    </Suspense>
  );
}
