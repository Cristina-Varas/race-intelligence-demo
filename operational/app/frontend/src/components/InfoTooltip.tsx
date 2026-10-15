import { CircleHelp } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { tooltipVisible } from '../utils/tooltipVisibility'
import { eventOperationsDefinition, type EventOperationsDefinitionId } from '../utils/eventOperationsDefinitions'
import { raceAnalysisDefinition, raceAnalysisDefinitions, type RaceAnalysisDefinitionId } from '../utils/raceAnalysisDefinitions'

interface Props {
  label: string
  children?: string
  definitionId?: RaceAnalysisDefinitionId | EventOperationsDefinitionId
}

const closeEventName = 'race-intelligence:close-info-tooltip'

export function InfoTooltip({ label, children, definitionId }: Props) {
  const [hovered, setHovered] = useState(false)
  const [keyboardFocused, setKeyboardFocused] = useState(false)
  const [touchOpen, setTouchOpen] = useState(false)
  const id = useId()
  const rootRef = useRef<HTMLSpanElement>(null)
  const pointerInitiatedFocus = useRef(false)

  useEffect(() => {
    if (!touchOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setTouchOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [touchOpen])

  useEffect(() => {
    const close = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) {
        setHovered(false)
        setKeyboardFocused(false)
        setTouchOpen(false)
      }
    }
    window.addEventListener(closeEventName, close)
    return () => window.removeEventListener(closeEventName, close)
  }, [id])

  const visible = tooltipVisible({ hovered, keyboardFocused, touchOpen })
  const definition = definitionId
    ? definitionId in raceAnalysisDefinitions ? raceAnalysisDefinition(definitionId as RaceAnalysisDefinitionId) : eventOperationsDefinition(definitionId as EventOperationsDefinitionId)
    : null
  const content = children ?? definition?.shortDescription ?? ''
  return (
    <span
      ref={rootRef}
      className="info-tooltip"
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') {
          window.dispatchEvent(new CustomEvent(closeEventName, { detail: id }))
          setHovered(true)
        }
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => {
        if (pointerInitiatedFocus.current) {
          pointerInitiatedFocus.current = false
          return
        }
        window.dispatchEvent(new CustomEvent(closeEventName, { detail: id }))
        setKeyboardFocused(true)
      }}
      onBlur={() => {
        setKeyboardFocused(false)
        setTouchOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setKeyboardFocused(false)
          setTouchOpen(false)
          event.currentTarget.querySelector<HTMLButtonElement>('button')?.blur()
        }
      }}
    >
      <button
        type="button"
        className="info-tooltip-trigger"
        aria-label={`About ${label}`}
        aria-describedby={visible ? id : undefined}
        onPointerDown={(event) => {
          pointerInitiatedFocus.current = true
          if (event.pointerType === 'touch') {
            window.dispatchEvent(new CustomEvent(closeEventName, { detail: id }))
            setTouchOpen((open) => !open)
          }
        }}
      ><CircleHelp size={14} strokeWidth={1.8} /></button>
      {visible ? <span id={id} role="tooltip" className="info-tooltip-content"><b>{definition?.title ?? label}</b>{content}<small>{definition?.longDescription}</small></span> : null}
    </span>
  )
}
