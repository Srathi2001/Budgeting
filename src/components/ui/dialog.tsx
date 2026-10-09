// Dialogs and side sheets on Radix (focus trap, Escape, return of focus, labelled by their title).
// ConfirmDialog replaces window.confirm / prompt for consequential actions: it says what will happen,
// takes an optional note, and the primary button is ink (destructive: with the error rule).
'use client';

import * as RD from '@radix-ui/react-dialog';
import { useCallback, useState, type ReactNode } from 'react';
import { Button } from './button';
import { Field, Textarea } from './field';
import { IconClose } from './icons';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** 'sheet': a full-height panel on the right (row forms, imports); default: a centred dialog */
  variant?: 'dialog' | 'sheet';
  /** dialog width in px (default 480) or sheet width (default 560) */
  width?: number;
  /** sheets that hold unsaved work ask before closing on Escape or scrim click */
  onBeforeClose?: () => boolean;
}

export function Dialog({ open, onOpenChange, title, description, children, footer, variant = 'dialog', width, onBeforeClose }: DialogProps) {
  const close = (next: boolean) => {
    if (!next && onBeforeClose && !onBeforeClose()) return;
    onOpenChange(next);
  };
  return (
    <RD.Root open={open} onOpenChange={close}>
      <RD.Portal>
        <RD.Overlay className="ui-scrim" />
        <RD.Content className={variant === 'sheet' ? 'ui-sheet' : 'ui-dialog'} style={width ? { width } : undefined} aria-describedby={description ? undefined : undefined}>
          <header className="ui-dialog__head">
            <div className="min-w-0">
              <RD.Title className="ui-dialog__title">{title}</RD.Title>
              {description ? <RD.Description className="ui-dialog__desc">{description}</RD.Description> : <RD.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RD.Description>}
            </div>
            <RD.Close asChild>
              <Button variant="tertiary" size="sm" iconOnly aria-label="Close" icon={<IconClose />} />
            </RD.Close>
          </header>
          <div className="ui-dialog__body">{children}</div>
          {footer && <footer className="ui-dialog__foot">{footer}</footer>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** what will happen, in one or two sentences */
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** asks for a note; `noteRequired` blocks confirm until one is typed */
  note?: { label: ReactNode; placeholder?: string; required?: boolean; initial?: string };
  /** resolves when done; an error message returned is shown in the dialog */
  onConfirm: (note: string | null) => Promise<string | null | void> | string | null | void;
}

export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false, note, onConfirm }: ConfirmDialogProps) {
  const [text, setText] = useState(note?.initial ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = !!note?.required && !text.trim();
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await onConfirm(note ? text.trim() || null : null);
      if (typeof r === 'string' && r) setError(r);
      else {
        onOpenChange(false);
        setText(note?.initial ?? '');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!busy) onOpenChange(o);
      }}
      title={title}
      description={body}
      footer={
        <>
          <Button variant="tertiary" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={run} loading={busy} disabled={missing}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {note && (
        <Field label={note.label} required={note.required} error={error ?? undefined}>
          <Textarea rows={3} value={text} placeholder={note.placeholder} onChange={(e) => setText(e.target.value)} autoFocus />
        </Field>
      )}
      {!note && error && (
        <p className="ui-field__error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export interface ConfirmOptions {
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/**
 * A promise-style confirm for the places that used window.confirm: `if (!(await confirm({...}))) return;`.
 * Render `element` once in the component so the dialog has a home.
 */
export function useConfirm(): { confirm: (opts: ConfirmOptions) => Promise<boolean>; element: ReactNode } {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ opts, resolve })), []);
  const element = state ? (
    <ConfirmDialog
      open
      onOpenChange={(o) => {
        if (o) return;
        state.resolve(false);
        setState(null);
      }}
      title={state.opts.title}
      body={state.opts.body}
      confirmLabel={state.opts.confirmLabel}
      cancelLabel={state.opts.cancelLabel}
      destructive={state.opts.destructive}
      onConfirm={() => {
        state.resolve(true);
        setState(null);
        return null;
      }}
    />
  ) : null;
  return { confirm, element };
}
