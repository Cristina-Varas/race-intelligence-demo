import { useEffect, useState } from 'react'

import { fetchRaceIntelligence } from '../api/raceIntelligence'
import type { RaceIntelligenceData } from '../types/raceIntelligence'

interface State {
  data: RaceIntelligenceData | null
  error: string | null
  loading: boolean
}

export function useRaceIntelligence(): State {
  const [state, setState] = useState<State>({ data: null, error: null, loading: true })

  useEffect(() => {
    const controller = new AbortController()
    fetchRaceIntelligence(controller.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setState({ data: null, error: error instanceof Error ? error.message : 'The API is unavailable.', loading: false })
      })
    return () => controller.abort()
  }, [])

  return state
}
