'use client';

import * as React from 'react';
import { m, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@/components/animate-ui/icons/icon';

type UploadProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    group: {
      initial: {
        y: 0,
        transition: { duration: 0.3, ease: 'easeInOut' },
      },
      animate: {
        y: -2,
        transition: { duration: 0.3, ease: 'easeInOut' },
      },
    },
    path1: {},
    path2: {},
    path3: {},
  } satisfies Record<string, Variants>,
  'default-loop': {
    group: {
      initial: {
        y: 0,
        transition: { duration: 0.6, ease: 'easeInOut' },
      },
      animate: {
        y: [0, -2, 0],
        transition: { duration: 0.6, ease: 'easeInOut' },
      },
    },
    path1: {},
    path2: {},
    path3: {},
  } satisfies Record<string, Variants>,
} as const;

// React 18 : forwardRef, sans quoi motion passe une ref à une fonction (avertissement).
const IconComponent = React.forwardRef<SVGSVGElement, UploadProps>(function IconComponent(
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
      <m.g variants={variants.group} initial="initial" animate={controls}>
        <m.path
          d="M12 3v12"
          variants={variants.path1}
          initial="initial"
          animate={controls}
        />
        <m.path
          d="m17 8-5-5-5 5"
          variants={variants.path2}
          initial="initial"
          animate={controls}
        />
      </m.g>
      <m.path
        d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
        variants={variants.path3}
        initial="initial"
        animate={controls}
      />
    </m.svg>
  );
});

function Upload(props: UploadProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Upload,
  Upload as UploadIcon,
  type UploadProps,
  type UploadProps as UploadIconProps,
};
