import {createRoot} from 'react-dom/client';
import './index.css';

// The static preview never imports the authenticated/payment application.
const module = import.meta.env.VITE_UI_PREVIEW === 'true'
  ? await import('./components/UIPreview')
  : await import('./App');
const App = module.default;
createRoot(document.getElementById('root')!).render(<App />);
