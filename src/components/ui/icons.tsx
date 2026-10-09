// 16 px line icons, 1.5 px stroke (design-system/README.md, Icons): status, navigation and actions only.
// Every icon is decorative on its own (aria-hidden); the surrounding control carries the label.
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconError = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" />
  </Icon>
);
export const IconWarning = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.25L14.25 13.25H1.75L8 2.25z" />
    <path d="M8 6.5v3M8 11.5v.25" />
  </Icon>
);
export const IconSuccess = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M5 8.25l2 2 4-4.5" />
  </Icon>
);
export const IconInfo = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 7.25v4M8 4.75v.25" />
  </Icon>
);
export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  </Icon>
);
export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 6l4.5 4.5L12.5 6" />
  </Icon>
);
export const IconChevronUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 10l4.5-4.5L12.5 10" />
  </Icon>
);
export const IconArrowUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
  </Icon>
);
export const IconArrowDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3v10M3.5 8.5L8 13l4.5-4.5" />
  </Icon>
);
export const IconMenu = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </Icon>
);
export const IconSidebar = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.25 2.75h11.5v10.5H2.25zM6 2.75v10.5" />
  </Icon>
);
export const IconSearch =(p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.25 10.25L13.5 13.5" />
  </Icon>
);
export const IconSpinner = (p: IconProps) => (
  <Icon {...p} className={`ui-spin ${p.className ?? ''}`}>
    <path d="M8 2.25A5.75 5.75 0 1 1 2.25 8" />
  </Icon>
);
