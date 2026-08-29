import type { ComponentProps } from 'react';

import { Button } from '@/design-system/primitives/button';

type IconButtonProps = Omit<ComponentProps<typeof Button>, 'aria-label' | 'size'> & {
  'aria-label': string;
  size?: 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';
};

function IconButton({ size = 'icon', ...props }: IconButtonProps) {
  return <Button size={size} {...props} />;
}

export { IconButton };
export type { IconButtonProps };
