'use client';

import * as React from 'react';
import { motion, isMotionComponent, type HTMLMotionProps } from 'motion/react';
import { cn } from '@/components/animate-ui/utils';

type AnyProps = Record<string, unknown>;

type DOMMotionProps<T extends HTMLElement = HTMLElement> = Omit<
  HTMLMotionProps<keyof HTMLElementTagNameMap>,
  'ref'
> & { ref?: React.Ref<T> };

type WithAsChild<Base extends object> =
  | (Base & { asChild: true; children: React.ReactElement })
  | (Base & { asChild?: false | undefined });

type SlotProps<T extends HTMLElement = HTMLElement> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children?: any;
} & DOMMotionProps<T>;

function mergeRefs<T>(
  ...refs: (React.Ref<T> | undefined)[]
): React.RefCallback<T> {
  return (node) => {
    refs.forEach((ref) => {
      if (!ref) return;
      if (typeof ref === 'function') {
        ref(node);
      } else {
        (ref as React.MutableRefObject<T | null>).current = node;
      }
    });
  };
}

function mergeProps<T extends HTMLElement>(
  childProps: AnyProps,
  slotProps: DOMMotionProps<T>,
): AnyProps {
  const merged: AnyProps = { ...childProps, ...slotProps };

  if (childProps.className || slotProps.className) {
    merged.className = cn(
      childProps.className as string,
      slotProps.className as string,
    );
  }

  if (childProps.style || slotProps.style) {
    merged.style = {
      ...(childProps.style as React.CSSProperties),
      ...(slotProps.style as React.CSSProperties),
    };
  }

  return merged;
}

// React 18 : la ref n'arrive pas dans les props, d'où forwardRef (le
// fichier d'origine vise React 19).
const Slot = React.forwardRef(function Slot<T extends HTMLElement = HTMLElement>(
  { children, ...props }: Omit<SlotProps<T>, 'ref'>,
  ref: React.ForwardedRef<T>,
) {
  const isAlreadyMotion =
    typeof children.type === 'object' &&
    children.type !== null &&
    isMotionComponent(children.type);

  const Base = React.useMemo(
    () =>
      isAlreadyMotion
        ? (children.type as React.ElementType)
        : motion.create(children.type as React.ElementType),
    [isAlreadyMotion, children.type],
  );

  if (!React.isValidElement(children)) return null;

  // React 18 : la ref de l'enfant est sur l'élément, pas dans ses props.
  const childRef = (children as { ref?: React.Ref<T> }).ref;
  const childProps = children.props as AnyProps;

  const mergedProps = mergeProps(childProps, props);

  return (
    <Base {...mergedProps} ref={mergeRefs(childRef, ref)} />
  );
  // Typage React 18 : les props HTML de motion portent une ref « legacy ».
}) as <T extends HTMLElement = HTMLElement>(
  props: Omit<SlotProps<T>, 'ref'> & { ref?: React.LegacyRef<T> },
) => React.ReactElement | null;

export {
  Slot,
  type SlotProps,
  type WithAsChild,
  type DOMMotionProps,
  type AnyProps,
};
