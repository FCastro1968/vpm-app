'use client'

interface Props {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function StaleWarningModal({
  open,
  title,
  description,
  confirmLabel = 'Delete Results & Save',
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)',
        zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'white', borderRadius: '12px', padding: '28px',
          maxWidth: '460px', width: '100%', margin: '0 20px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '14px' }}>
          <span style={{ fontSize: '22px', flexShrink: 0, lineHeight: 1 }}>⚠️</span>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', lineHeight: 1.4, margin: 0 }}>
            {title}
          </h2>
        </div>

        <p style={{ fontSize: '14px', color: '#374151', lineHeight: 1.6, marginBottom: '10px' }}>
          {description}
        </p>

        <p style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.5, marginBottom: '24px' }}>
          To preserve the current results,{' '}
          <strong style={{ color: '#374151' }}>clone this project</strong> from the dashboard before continuing.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 18px', border: '1px solid #d1d5db', borderRadius: '6px',
              fontSize: '14px', color: '#374151', cursor: 'pointer', background: 'white',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 18px', background: '#dc2626', border: 'none',
              borderRadius: '6px', fontSize: '14px', fontWeight: 500,
              color: 'white', cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
