import type { ReactElement, TextareaHTMLAttributes } from 'react';
import { cx } from './classnames';

export type TextAreaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id' | 'aria-invalid' | 'aria-describedby'
> & {
  readonly id: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
};

export function TextArea({
  id,
  label,
  hint,
  error,
  className,
  ...rest
}: TextAreaProps): ReactElement {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ');

  return (
    <div className={cx('achat-field', className)}>
      <label className="achat-field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        {...rest}
        id={id}
        className="achat-field__input achat-field__textarea"
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
      />
      {hint === undefined ? null : (
        <p className="achat-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="achat-field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
