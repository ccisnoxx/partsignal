import type { Preview } from '@storybook/react-vite';
import { TooltipProvider } from '@/design-system/primitives/tooltip';
import '@/styles/global.css';

const preview: Preview = {
  decorators: [
    (Story) => (
      <TooltipProvider>
        <div className="min-h-screen bg-surface-app p-6 text-text-primary">
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
  parameters: {
    a11y: { test: 'error' },
    controls: { expanded: true },
    viewport: {
      options: {
        mobile375: {
          name: 'Mobile 375',
          styles: { width: '375px', height: '812px' },
        },
        tablet768: {
          name: 'Tablet 768',
          styles: { width: '768px', height: '1024px' },
        },
        desktop1024: {
          name: 'Desktop 1024',
          styles: { width: '1024px', height: '768px' },
        },
        desktop1440: {
          name: 'Desktop 1440',
          styles: { width: '1440px', height: '900px' },
        },
      },
    },
  },
};

export default preview;
