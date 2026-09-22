import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './landing/Landing';
import './styles/tokens.css';
import './styles/base.css';

// The explanatory simulation stays independent of the operational application.
const prototypeUrl = import.meta.env.VITE_PROTOTYPE_URL || 'http://localhost:3000/explore';
function openPrototype() { window.location.assign(prototypeUrl); }
const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(<StrictMode><Landing onEnter={openPrototype} /></StrictMode>);
