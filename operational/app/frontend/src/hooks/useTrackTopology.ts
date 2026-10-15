import { useEffect, useState } from 'react'

import { fetchTrackTopology } from '../api/raceIntelligence'
import type { TrackTopology } from '../types/raceIntelligence'

export function useTrackTopology() {
  const [topology, setTopology] = useState<TrackTopology | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchTrackTopology(controller.signal).then(setTopology).catch(() => {
      // Spatial metadata must not make governed timing analytics unavailable.
      if (!controller.signal.aborted) setTopology(null)
    })
    return () => controller.abort()
  }, [])

  return topology
}
