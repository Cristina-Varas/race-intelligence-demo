import type { CustomSimulationResult } from '../types/raceIntelligence'

/** Small deterministic test result; not a production population generator. */
export function modelledCardScenario(): CustomSimulationResult {
  return { fieldMode: 'synthetic_100', fieldEvidenceType: 'SYNTHETIC', raceModel: { mode: 'TRAFFIC_ADJUSTED' },
    raceLaps: 5, virtualMaxPace: 80, startingDelaySeconds: 1.5,
    syntheticReplay: { scenarioId: 'card-test', raceLaps: 5, entities: Array.from({length:100}, (_, i) => ({
      driverId: `SYN_${String(i + 1).padStart(3,'0')}`, gridPosition: i + 1, paceSecondsPerLap: 81 + i / 100,
      timingCatchTimeSeconds: 999, entityType: 'synthetic',
    })) },
    trafficAdjusted: { rankTrajectory: Array.from({length:5},(_,i)=>({lap:i+1,rank:Math.max(1,81-i*20),raceTimeSeconds:1.5+(i+1)*82})),
      clearanceEvents: Array.from({length:99},(_,i)=>({driverIndex:i,timingCatchTimeSeconds:10+Math.floor(i/2)*5,lap:Math.ceil((10+Math.floor(i/2)*5)/82),clearTimeSeconds:11+Math.floor(i/2)*5})) },
  } as unknown as CustomSimulationResult
}
