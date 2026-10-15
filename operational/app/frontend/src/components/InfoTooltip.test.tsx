import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { InfoTooltip } from './InfoTooltip'

describe('InfoTooltip DOM visibility', () => {
  it('does not mount panels initially and only mounts the hovered or focused panel', () => {
    render(<><InfoTooltip label="First">First detail</InfoTooltip><InfoTooltip label="Second">Second detail</InfoTooltip></>)
    const [first, second] = screen.getAllByRole('button')

    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerEnter(first, { pointerType: 'mouse' })
    expect(screen.getByRole('tooltip').textContent).toContain('First detail')
    expect(screen.queryByText('Second detail')).toBeNull()

    fireEvent.pointerEnter(second, { pointerType: 'mouse' })
    expect(screen.getByRole('tooltip').textContent).toContain('Second detail')
    expect(screen.queryByText('First detail')).toBeNull()

    fireEvent.pointerLeave(second, { pointerType: 'mouse' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(second)
    expect(screen.getByRole('tooltip').textContent).toContain('Second detail')
    fireEvent.blur(second)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('closes any prior touch-open panel before opening another', () => {
    render(<><InfoTooltip label="First">First detail</InfoTooltip><InfoTooltip label="Second">Second detail</InfoTooltip></>)
    const [first, second] = screen.getAllByRole('button')

    fireEvent.pointerDown(first, { pointerType: 'touch' })
    expect(screen.getByRole('tooltip').textContent).toContain('First detail')
    fireEvent.pointerDown(second, { pointerType: 'touch' })
    expect(screen.getByRole('tooltip').textContent).toContain('Second detail')
    expect(screen.queryByText('First detail')).toBeNull()
  })

  it('uses the shared Race Analysis definition without changing any application state', () => {
    render(<InfoTooltip label="Start Delay" definitionId="start-delay" />)
    const trigger = screen.getByRole('button', { name: 'About Start Delay' })
    fireEvent.focus(trigger)
    expect(screen.getByRole('tooltip').textContent).toMatch(/Positive values mean Virtual Max starts later/i)
    expect(screen.getByRole('tooltip').textContent).toMatch(/timing advantage/i)
  })

  it('states that Timing Catch does not confirm a physical pass', () => {
    render(<InfoTooltip label="Timing Catch" definitionId="timing-catch" />)
    fireEvent.focus(screen.getByRole('button', { name: 'About Timing Catch' }))
    expect(screen.getByRole('tooltip').textContent).toContain('Timing Catch does not imply that a physical pass occurred.')
  })
})
