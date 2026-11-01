import { QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

// The app's provider stack — shared by the browser entry (main.jsx) and the build-time prerender
// (entry-prerender.jsx), so the HTML the build writes and the tree that hydrates it can't drift apart:
// any difference between the two throws the server HTML away on load. The router is passed in —
// BrowserRouter in the browser, StaticRouter at build time — and `pages` hands App already-loaded page
// components for the routes that were prerendered (App.jsx).
const AppTree = ({ queryClient, Router, routerProps, pages }) => (
  <QueryClientProvider client={queryClient}>
    <Router {...routerProps}>
      <AuthProvider>
        <ErrorBoundary>
          <App pages={pages} />
        </ErrorBoundary>
      </AuthProvider>
    </Router>
  </QueryClientProvider>
);

export default AppTree;
