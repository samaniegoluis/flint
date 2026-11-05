import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/primitives.css';
import './styles/app.css';
import { App } from './App';
import { injectSprite } from './ui/Icon';

injectSprite();
createRoot(document.getElementById('root')!).render(<App />);
