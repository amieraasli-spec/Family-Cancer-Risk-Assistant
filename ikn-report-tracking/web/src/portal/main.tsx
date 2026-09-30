import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/theme.css';
import './portal.css';
import PortalApp from './PortalApp.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from semakan.html');
createRoot(container).render(<StrictMode><PortalApp /></StrictMode>);
