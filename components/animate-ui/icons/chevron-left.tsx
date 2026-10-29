'use client';

import * as React from 'react';
import { m, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@/components/animate-ui/icons/icon';

type ChevronLeftProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    path: {
      initial: {
        x: 0,
        transition: { duration: 0.3, ease: 'easeInOut' },
      },
      animate: {
        x: -4,
        transition: { duration: 0.3, ease: 'easeInOut' },
      },
    },
  } satisfies Record<string, Variants>,
  'default-loop': {
    path: {
      initial: {
        x: 0,
      },
      animate: {
        x: [0, -4, 0],
        transition: { duration: 0.6, ease: 'easeInOut' },
      },
    },
  } satisfies Record<string, Variants>,
} as const;

// React 18 : forwardRef, sans quoi motion passe une ref à une fonction (avertissement).
const IconComponent = React.forwardRef<SVGSVGElement, ChevronLeftProps>(function IconComponent(
  { size, ...props },
  ref,
) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);

  return (
    <m.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
      ref={ref}
    >
      <m.path
        d="m15 18-6-6 6-6"
        variants={variants.path}
        initial="initial"
        animate={controls}
      />
    </m.svg>
  );
});

function ChevronLeft(props: ChevronLeftProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  ChevronLeft,
  ChevronLeft as ChevronLeftIcon,
  type ChevronLeftProps,
  type ChevronLeftProps as ChevronLeftIconProps,
};
