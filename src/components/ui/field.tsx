// Form fields: a label, the control, an optional hint and an error that the control is described by.
// Controls are plain inputs with the ui-input look; a locked value is a read-only control (gray, no edge).
'use client';

import { createContext, forwardRef, useContext, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { IconError } from './icons';

interface FieldCtx {
  id: string;
  describedBy?: string;
  invalid: boolean;
}
const Ctx = createContext<FieldCtx | null>(null);

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className = '',
  inline = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** the error message; sets aria-invalid on the control and is read with it */
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  /** label beside the control (checkboxes, short inputs) */
  inline?: boolean;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`ui-field${inline ? ' ui-field--inline' : ''}${error ? ' is-invalid' : ''} ${className}`}>
      <label htmlFor={id} className="ui-field__label">
        {label}
        {required && (
          <span className="ui-field__req" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <Ctx.Provider value={{ id, describedBy, invalid: !!error }}>{children}</Ctx.Provider>
      {error && (
        <p id={errorId} className="ui-field__error" role="alert">
          <IconError size={14} />
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="ui-field__hint">
          {hint}
        </p>
      )}
    </div>
  );
}

function useField() {
  return useContext(Ctx);
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { numeric?: boolean };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className = '', numeric, ...rest }, ref) {
  const f = useField();
  return (
    <input
      ref={ref}
      id={rest.id ?? f?.id}
      aria-describedby={rest['aria-describedby'] ?? f?.describedBy}
      aria-invalid={rest['aria-invalid'] ?? (f?.invalid || undefined)}
      inputMode={numeric ? 'decimal' : rest.inputMode}
      className={`ui-input${numeric ? ' ui-input--num' : ''} ${className}`}
      {...rest}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = '', ...rest }, ref) {
  const f = useField();
  return <select ref={ref} id={rest.id ?? f?.id} aria-describedby={rest['aria-describedby'] ?? f?.describedBy} aria-invalid={rest['aria-invalid'] ?? (f?.invalid || undefined)} className={`ui-input ui-select ${className}`} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...rest }, ref) {
  const f = useField();
  return <textarea ref={ref} id={rest.id ?? f?.id} aria-describedby={rest['aria-describedby'] ?? f?.describedBy} aria-invalid={rest['aria-invalid'] ?? (f?.invalid || undefined)} className={`ui-input ui-textarea ${className}`} {...rest} />;
});

/** A fixed value shown where an input would be: gray, no edge, never mistaken for something to type in. */
export function ReadOnlyValue({ children, numeric = false, title }: { children: ReactNode; numeric?: boolean; title?: string }) {
  const f = useField();
  return (
    <div id={f?.id} className={`ui-readonly${numeric ? ' ui-input--num' : ''}`} title={title} tabIndex={-1}>
      {children === null || children === undefined || children === '' ? '—' : children}
    </div>
  );
}
