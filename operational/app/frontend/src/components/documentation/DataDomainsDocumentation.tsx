import { DocumentationImage } from './DocumentationImage'
import { ProvenanceBadge } from './DocumentationShared'

const domains = [
  {
    type: 'historical' as const,
    title: 'Historical Evidence',
    source: 'Supplied historical motorsport timing data and observed past timing evidence.',
    usedFor: 'Pace profiling · variability estimation · historical comparisons · governed analytical baseline.',
    storage: 'Bronze Historical → Silver Historical → Gold Historical',
    safeguards: ['16 supported historical source participant IDs', 'Participant IDs are categorical identifiers', 'Max Verstappen is not present in the supplied historical dataset', 'Participant #13 must never be labelled Max Verstappen'],
  },
  {
    type: 'synthetic' as const,
    title: 'Synthetic Scenarios',
    source: 'Scenario assumptions, Virtual Max configuration, field generation rules and simulation parameters.',
    usedFor: 'Deterministic chase analysis · Monte Carlo simulation · delayed-start exploration · Synthetic100 stress testing.',
    storage: 'Scenario configuration → Gold Scenario → simulation engine',
    safeguards: ['Virtual Max is a synthetic WHAT-IF reference', 'It is not measured or learned Verstappen performance', 'Synthetic100 is not historical augmentation', 'Synthetic outputs do not automatically enter Historical Evidence'],
  },
  {
    type: 'event' as const,
    title: 'Actual Event',
    source: 'AKS live timing, recorded AKS sessions, operator/manual capture and event scenario snapshots.',
    usedFor: 'Race Operations · factual replay · prediction vs reality · participant cards · event storyline / debrief.',
    storage: 'Bronze Event → Silver Event → Gold Event',
    safeguards: ['Factual event evidence is governed separately', 'Timing catch is not automatically a physical pass', 'Actual Event data is never automatically promoted into Historical Evidence'],
  },
]

const principles = [
  'Observed ≠ Modelled ≠ Captured',
  'Historical Evidence remains observational',
  'Synthetic outputs remain explicitly modelled',
  'Actual Event remains independently captured evidence',
  'Provenance is visible end-to-end',
  'Cross-domain promotion requires explicit governed logic',
]

export function DataDomainsDocumentation() {
  return <>
    <section className="docs-page-heading">
      <p className="eyebrow">GOVERNED EVIDENCE</p>
      <h1>Data Domains &amp; Governance</h1>
      <p>Race Intelligence separates observed evidence, modelled scenarios and independently captured event data by design.</p>
      <p className="docs-domains-intro">Three governed domains preserve provenance end-to-end and prevent modelled or captured data being misrepresented as historical evidence.</p>
    </section>
    <DocumentationImage src="/assets/documentation/race-intelligence-data-domains-governance.png" label="Data domains and governance infographic" alt="Race Intelligence data governance infographic comparing Historical Evidence, Synthetic Scenarios and Actual Event domains." caption="Historical Evidence, Synthetic Scenarios and Actual Event data are governed as distinct domains with explicit provenance and promotion rules." />
    <section className="docs-domain-detail-grid" aria-label="Three governed data domains">
      {domains.map((domain) => <article className={`docs-domain-detail docs-domain-detail--${domain.type}`} key={domain.type}>
        <ProvenanceBadge type={domain.type} />
        <h2>{domain.title}</h2>
        <DomainSection title="Source" content={domain.source} />
        <DomainSection title="Used for" content={domain.usedFor} />
        <DomainSection title="Storage" content={domain.storage} />
        <div className="docs-domain-safeguards"><h3>Safeguards</h3><ul>{domain.safeguards.map((safeguard) => <li key={safeguard}>{safeguard}</li>)}</ul></div>
      </article>)}
    </section>
    <section className="docs-principles" aria-labelledby="docs-principles-title">
      <h2 id="docs-principles-title">Domain Separation Principles</h2>
      <ol>{principles.map((principle, index) => <li key={principle}><b>{String(index + 1).padStart(2, '0')}</b><span>{principle}</span></li>)}</ol>
      <p>Actual Event data is never automatically promoted into Historical Evidence.</p>
    </section>
    <section className="docs-domain-comparison" aria-labelledby="docs-domain-comparison-title">
      <h2 id="docs-domain-comparison-title">At a glance</h2>
      <div className="docs-domain-comparison__scroll"><table><thead><tr><th>Dimension</th><th>Historical Evidence</th><th>Synthetic Scenarios</th><th>Actual Event</th></tr></thead><tbody>
        <tr><th>Source</th><td>Observed</td><td>Modelled</td><td>Captured</td></tr>
        <tr><th>Trust model</th><td>Evidential</td><td>Scenario-based</td><td>Factual event evidence</td></tr>
        <tr><th>Primary storage</th><td>Gold Historical</td><td>Gold Scenario</td><td>Gold Event</td></tr>
        <tr><th>Primary app surface</th><td>Race Analysis</td><td>Simulation</td><td>Race Operations</td></tr>
        <tr><th>Typical outputs</th><td>Profiles / variability / comparisons</td><td>Probabilities / what-if outputs</td><td>Replay / cards / debrief</td></tr>
      </tbody></table></div>
    </section>
  </>
}

function DomainSection({ title, content }: { title: string; content: string }) {
  return <div className="docs-domain-section"><h3>{title}</h3><p>{content}</p></div>
}
