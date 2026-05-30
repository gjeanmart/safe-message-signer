/**
 * Copyable — renders a value in a <code> box with a small "Copy" button.
 *
 * Uses the async Clipboard API when available, with a `document.execCommand`
 * fallback for restricted cross-origin iframe contexts (a Safe App runs inside
 * the Wallet's iframe, where `navigator.clipboard` may be blocked by the
 * parent's Permissions-Policy).
 */

import { useState } from 'react'

/**
 * Copies text to the clipboard, preferring the async Clipboard API and falling
 * back to a hidden-textarea `execCommand('copy')` for restricted iframe contexts.
 *
 * @param text - The text to copy.
 * @returns `true` if the copy succeeded, `false` otherwise.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the execCommand fallback */
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** Clipboard glyph shown in the idle state. */
const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

/** Checkmark glyph shown briefly after a successful copy. */
const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

/**
 * Renders a value in a `<code>` box with a compact copy-to-clipboard icon
 * button that flips to a checkmark for ~1.2s on success.
 *
 * @param props.value - The text shown and copied.
 * @param props.title - Optional tooltip / accessible label (defaults to "Copy to clipboard").
 * @returns The inline copyable element.
 */
export function Copyable({ value, title }: { value: string; title?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const onCopy = async () => {
    const ok = await copyText(value)
    setState(ok ? 'copied' : 'failed')
    window.setTimeout(() => setState('idle'), 1200)
  }

  return (
    <span className="copyable">
      <code>{value}</code>
      <button
        type="button"
        className={`copy-btn${state === 'copied' ? ' copied' : ''}`}
        onClick={onCopy}
        title={state === 'failed' ? 'Copy failed' : title ?? 'Copy to clipboard'}
        aria-label={title ?? 'Copy to clipboard'}
      >
        {state === 'copied' ? <CheckIcon /> : <CopyIcon />}
      </button>
    </span>
  )
}
