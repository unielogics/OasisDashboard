import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'
import { errorTextStyle, inputStyle, labelStyle } from './styles'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'style' | 'id'> {
  label: string
  error?: string | null
}

/** Settings drawer field: small label above a 46px input; the inline error uses the drawer's red. */
export function Field({ label, error, ...input }: Props) {
  const id = useId()
  return (
    <div style={{ marginBottom: '14px' }}>
      <label htmlFor={id} style={{ ...labelStyle, display: 'block' }}>
        {label}
      </label>
      <input
        id={id}
        {...input}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        style={inputStyle(!!error)}
      />
      {error && (
        <div id={`${id}-err`} role="alert" style={{ ...errorTextStyle, marginTop: '6px' }}>
          {error}
        </div>
      )}
    </div>
  )
}
