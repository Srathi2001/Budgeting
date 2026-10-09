// Button: one component for every action. Ink means attention (design-system/README.md): one primary
// action per view; destructive confirms are primary with the error rule; everything else is secondary
// (outlined) or tertiary (text). States: hover, focus-visible, disabled, loading (label kept, spinner).
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { IconSpinner } from './icons';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** shows a spinner and blocks clicks; the label stays so the width does not jump */
  loading?: boolean;
  /** icon-only buttons must pass an aria-label */
  iconOnly?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, iconOnly = false, icon, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`ui-btn ui-btn--${variant} ui-btn--${size}${iconOnly ? ' ui-btn--icon' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <IconSpinner /> : icon}
      {!iconOnly && <span>{children}</span>}
      {iconOnly && !icon && !loading && children}
    </button>
  );
});
