import { InfoTooltip } from './InfoTooltip'
import type { FieldMode } from '../types/raceIntelligence'

export function FieldModeSelector({ value, onChange }: { value: FieldMode; onChange: (value: FieldMode) => void }) {
  return <section className="field-mode" aria-labelledby="field-mode-title">
    <div><p className="eyebrow" id="field-mode-title">Field mode</p><span className="field-mode-help"><InfoTooltip label="Field mode" definitionId="field-mode" /></span></div>
    <div className="field-mode-options">
      <button type="button" className={value === 'historical' ? 'active' : ''} aria-pressed={value === 'historical'} onClick={() => onChange('historical')}><strong>OBSERVED 16</strong><span>HISTORICAL EVIDENCE</span><small>Supported historical source drivers with sufficient evidence for the current analysis.</small></button>
      <button type="button" className={value === 'synthetic_100' ? 'active synthetic' : ''} aria-pressed={value === 'synthetic_100'} onClick={() => onChange('synthetic_100')}><strong>SYNTHETIC 100</strong><span>STRESS TEST</span><small>Generated field. Not additional historical evidence.</small></button>
    </div>
  </section>
}
