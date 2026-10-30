/**
 * Entry point: sets up the root element and renders the app. Included from
 * `src/index.html`.
 */
import {StrictMode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {App} from './App';
import {Toaster} from './components/ui/sonner';
import {TooltipProvider} from './components/ui/tooltip';

const elem = document.getElementById('root')!;
const app = (
  <StrictMode>
    <TooltipProvider>
      <App />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  </StrictMode>
);

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
if (import.meta.hot) {
  type HotData = {root?: Root};
  ((import.meta.hot.data as HotData).root ??= createRoot(elem)).render(app);
} else {
  createRoot(elem).render(app);
}
