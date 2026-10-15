import { Expand, X } from 'lucide-react'
import { useEffect, useState } from 'react'

type DocumentationImageProps = { src: string; alt: string; label: string; caption: string }

export function DocumentationImage({ src, alt, label, caption }: DocumentationImageProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [imageUnavailable, setImageUnavailable] = useState(false)

  useEffect(() => {
    if (!isExpanded) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsExpanded(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isExpanded])

  return <>
    <figure className="docs-image">
      <button type="button" className="docs-image__trigger" onClick={() => setIsExpanded(true)} aria-label={`Expand ${label}`} disabled={imageUnavailable}>
        {imageUnavailable ? <div role="img" aria-label={alt} style={{ padding: '2rem', color: '#a5b6c7', background: '#0b1a2b' }}>Illustration available in the private project documentation.</div> : <img src={src} alt={alt} onError={() => setImageUnavailable(true)} />}
        {!imageUnavailable && <span><Expand size={16} /> Expand infographic</span>}
      </button>
      <figcaption><b>{label}</b>{caption}</figcaption>
    </figure>
    {isExpanded && <div className="docs-image-lightbox" role="dialog" aria-modal="true" aria-label={`${label} expanded`} onMouseDown={(event) => {
      if (event.target === event.currentTarget) setIsExpanded(false)
    }}>
      <div className="docs-image-lightbox__panel">
        <button type="button" className="docs-image-lightbox__close" onClick={() => setIsExpanded(false)} aria-label={`Close ${label}`}><X size={18} /> Close</button>
        <img src={src} alt={alt} />
      </div>
    </div>}
  </>
}
