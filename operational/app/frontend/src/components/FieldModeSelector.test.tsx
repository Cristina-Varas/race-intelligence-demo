import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { FieldModeSelector } from './FieldModeSelector'

describe('FieldModeSelector', () => {
  it('renders observed and synthetic field choices before any simulation result', () => {
    const html = renderToStaticMarkup(<FieldModeSelector value="synthetic_100" onChange={vi.fn()} />)
    expect(html).toContain('OBSERVED 16')
    expect(html).toContain('SYNTHETIC 100')
    expect(html).toContain('Not additional historical evidence')
  })
})
