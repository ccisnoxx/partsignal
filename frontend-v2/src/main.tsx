/** V2 浏览器入口，先配置全局校验运行时，再装配应用 Provider。 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import './styles/global.css';

z.config({ jitless: true });

void import('./app/providers').then(({ AppProviders }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProviders />
    </StrictMode>,
  );
});
