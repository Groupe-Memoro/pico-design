'use client';

import * as React from 'react';
import { m, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@/components/animate-ui/icons/icon';

type MenuProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    line1: {
      initial: {
        rotate: 0,
        x: 0,
        y: 0,
      },
      animate: {
        rotate: -45,
        x: -2.35,
        y: 0.35,
        transformOrigin: 'top right',
        transition: {
          type: 'spring',
          stiffness: 200,
          damping: 20,
        },
      },
    },
    line2: {
      initial: {
        opacity: 1,
      },
      animate: {
        opacity: 0,
        transition: {
          ease: 'easeInOut',
          duration: 0.2,
        },
      },
    },
    line3: {
      initial: {
        rotate: 0,
        x: 0,
        y: 0,
      },
      animate: {
        rotate: 45,
        x: -2.35,
        y: -0.35,
        transformOrigin: 'bottom right',
        transition: {
          type: 'spring',
          stiffness: 200,
          damping: 20,
        },
      },
    },
  } satisfies Record<string, Variants>,
} as const;

// React 18 : forwardRef, sans quoi motion passe une ref à une fonction (avertissement).
const IconComponent = React.forwardRef<SVGSVGElement, MenuProps>(function IconComponent(
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
      <m.line
        x1={4}
        y1={6}
        x2={20}
        y2={6}
        variants={variants.line1}
        initial="initial"
        animate={controls}
      />
      <m.line
        x1={4}
        y1={12}
        x2={20}
        y2={12}
        variants={variants.line2}
        initial="initial"
        animate={controls}
      />
      <m.line
        x1={4}
        y1={18}
        x2={20}
        y2={18}
        variants={variants.line3}
        initial="initial"
        animate={controls}
      />
    </m.svg>
  );
});

function Menu(props: MenuProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Menu,
  Menu as MenuIcon,
  type MenuProps,
  type MenuProps as MenuIconProps,
};
