import { ChevronDown, ChevronLeft, ChevronRight, Menu, ShieldCheck, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ArchitectureDocumentation } from './ArchitectureDocumentation'
import { DataDomainsDocumentation } from './DataDomainsDocumentation'
import { AidpLakehouseDocumentation } from './AidpLakehouseDocumentation'
import { documentationGroups, documentationPages, groupFor, pageFor, type DocumentationGroup, type DocumentationPageId } from './DocumentationShared'
import { OverviewDocumentation } from './OverviewDocumentation'
import { MathematicalMethodology } from './MathematicalMethodology'
import { RaceAnalysisPages } from './RaceAnalysisPages'
import { EventOperationsPages } from './EventOperationsPages'

export function DocumentationLayout() {
  const [page, setPage] = useState<DocumentationPageId>('overview')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expanded, setExpanded] = useState<Record<DocumentationGroup['id'], boolean>>({ analysis: false, operations: false })
  const current = pageFor(page)
  const activeGroup = groupFor(page)
  useEffect(() => { if (activeGroup) setExpanded((state) => ({ ...state, [activeGroup.id]: true })) }, [activeGroup])
  const selectPage = (id: DocumentationPageId) => { setPage(id); setMobileOpen(false) }
  const content = useMemo(() => {
    if (page === 'overview') return <OverviewDocumentation />
    if (page === 'architecture') return <ArchitectureDocumentation />
    if (page === 'domains') return <DataDomainsDocumentation />
    if (page === 'lakehouse') return <AidpLakehouseDocumentation />
    if (page === 'analysis-mathematics') return <MathematicalMethodology />
    if (activeGroup?.id === 'analysis') return <RaceAnalysisPages page={page} onNavigate={selectPage} />
    if (activeGroup?.id === 'operations') return <EventOperationsPages page={page} onNavigate={selectPage} />
    return <DocumentationPlaceholder title={current.label} />
  }, [activeGroup?.id, current.label, page])
  const siblings = activeGroup?.children ?? []
  const index = siblings.findIndex((item) => item.id === page)
  const previous = index > 0 ? siblings[index - 1] : undefined
  const next = index >= 0 ? siblings[index + 1] : undefined
  const breadcrumb = activeGroup ? `DOCUMENTATION / ${activeGroup.label.toUpperCase()}${current.label !== 'Overview' ? ` / ${current.label.toUpperCase()}` : ''}` : `DOCUMENTATION / ${current.label.toUpperCase()}`
  return <section className="documentation-page" aria-labelledby="documentation-title">
    <button type="button" className="docs-mobile-toggle" aria-expanded={mobileOpen} aria-controls="documentation-navigation" onClick={() => setMobileOpen((open) => !open)}>{mobileOpen ? <X size={18} /> : <Menu size={18} />} Documentation navigation</button>
    <aside id="documentation-navigation" className={`docs-navigation ${mobileOpen ? 'is-mobile-open' : ''}`} aria-label="Documentation pages"><div><span className="docs-kicker">RACE INTELLIGENCE</span><strong>KNOWLEDGE<br />AREA</strong></div><nav>{documentationPages.slice(0, 4).map((item) => <NavPage key={item.id} item={item} active={page === item.id} onSelect={selectPage} />)}{documentationGroups.map((group) => <NavGroup key={group.id} group={group} activePage={page} open={expanded[group.id]} onSelect={selectPage} onToggle={() => setExpanded((state) => ({ ...state, [group.id]: !state[group.id] }))} />)}{documentationPages.slice(4).map((item) => <NavPage key={item.id} item={item} active={page === item.id} onSelect={selectPage} />)}</nav><p><ShieldCheck size={14} /> Observed, modelled and captured evidence remain separate.</p></aside>
    <div className="docs-content"><header className="docs-page-top"><span>{breadcrumb}</span><small>{activeGroup ? `${index + 1} / ${siblings.length}` : 'TOP LEVEL'}</small></header><main id="documentation-title">{content}</main>{activeGroup && <footer className="docs-page-footer docs-group-footer"><button type="button" disabled={!previous} onClick={() => previous && selectPage(previous.id)}><ChevronLeft size={16} /> {previous?.label ?? 'Previous'}</button><button type="button" disabled={!next} onClick={() => next && selectPage(next.id)}>{next?.label ?? 'Next'} <ChevronRight size={16} /></button></footer>}</div>
  </section>
}
function NavPage({ item, active, onSelect }: { item: { id: DocumentationPageId; label: string }; active: boolean; onSelect: (id: DocumentationPageId) => void }) { return <button type="button" className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => onSelect(item.id)}>{item.label}</button> }
function NavGroup({ group, activePage, open, onSelect, onToggle }: { group: DocumentationGroup; activePage: DocumentationPageId; open: boolean; onSelect: (id: DocumentationPageId) => void; onToggle: () => void }) { const active = group.children.some((item) => item.id === activePage); return <div className={`docs-nav-group ${active ? 'is-active' : ''}`}><div className="docs-nav-parent"><button type="button" className={activePage === group.overviewId ? 'active' : ''} aria-current={activePage === group.overviewId ? 'page' : undefined} onClick={() => onSelect(group.overviewId)}>{group.label}</button><button type="button" className="docs-nav-expander" aria-label={`Toggle ${group.label} pages`} aria-expanded={open} aria-controls={`docs-nav-${group.id}`} onClick={onToggle}><ChevronDown size={16} /></button></div><div id={`docs-nav-${group.id}`} className="docs-nav-children" hidden={!open}>{group.children.map((item) => <button type="button" key={item.id} className={activePage === item.id ? 'active' : ''} aria-current={activePage === item.id ? 'page' : undefined} onClick={() => onSelect(item.id)}>{item.label}</button>)}</div></div> }
function DocumentationPlaceholder({ title }: { title: string }) { return <section className="docs-placeholder"><p className="eyebrow">DOCUMENTATION PAGE</p><h1>{title}</h1><p>This dedicated documentation view is prepared for the next approved content pass. It remains separate from Race Analysis scenarios and Event Operations data.</p></section> }
