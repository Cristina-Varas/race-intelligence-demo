import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DeterministicChase } from './DeterministicChase'

describe('DeterministicChase', () => {
  it('labels the chart as the deterministic maximum-delay boundary rather than the active scenario gap', () => {
    const html = renderToStaticMarkup(<DeterministicChase raceLaps={30} deterministicDelay={5.85} fastestObservedPace={80.293} virtualMaxPace={80.098} />)

    expect(html).toContain('Maximum-delay gap')
    expect(html).toContain('deterministic maximum delayed start (+5.85 s)')
    expect(html).toContain('not the active scenario gap')
  })
})
