import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { signedSeconds } from './Format'

interface Props {
  raceLaps: number
  deterministicDelay: number
  fastestObservedPace: number
  virtualMaxPace: number
}

interface TimingGapPoint {
  lap: number
  remainingGap: number
}

function TimingGapTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: TimingGapPoint }> }) {
  if (!active || !payload?.[0]) return null
  const point = payload[0].payload
  return (
    <div className="telemetry-tooltip timing-gap-tooltip">
      <span className="telemetry-tooltip-label">LAP {Math.trunc(point.lap)}</span>
      <div className="telemetry-tooltip-reading">
        <span>REMAINING GAP</span>
          <strong>{`${point.remainingGap.toFixed(3)} s`}</strong>
      </div>
    </div>
  )
}

export function DeterministicChase({ raceLaps, deterministicDelay, fastestObservedPace, virtualMaxPace }: Props) {
  const gain = fastestObservedPace - virtualMaxPace
  const data = Array.from({ length: raceLaps + 1 }, (_, lap) => ({
    lap,
    remainingGap: deterministicDelay - lap * gain,
  }))
  const finalGap = data[data.length - 1]?.remainingGap ?? 0

  return (
    <section className="panel chase-panel" aria-labelledby="chase-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Deterministic limit</p>
          <h2 id="chase-title">Maximum-delay gap</h2>
        </div>
        <span className="unit-label">FINAL GAP {signedSeconds(finalGap, 3)}</span>
      </div>
      <div className="chart-wrap compact-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: -10 }}>
            <XAxis dataKey="lap" stroke="#696969" tick={{ fill: '#a9a9a9', fontSize: 11 }} />
            <YAxis dataKey="remainingGap" stroke="#696969" tickFormatter={(value) => `${value.toFixed(1)}s`} tick={{ fill: '#a9a9a9', fontSize: 11 }} />
            <Tooltip content={<TimingGapTooltip />} cursor={{ stroke: '#ffffff', strokeOpacity: 0.16 }} />
            <Line type="linear" dataKey="remainingGap" stroke="#ececec" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#ececec', stroke: '#171717', strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="panel-note">Gap trajectory at the deterministic maximum delayed start ({signedSeconds(deterministicDelay, 2)}). This is a limit boundary, not the active scenario gap. Timing catch only, not an overtake trajectory.</p>
    </section>
  )
}
