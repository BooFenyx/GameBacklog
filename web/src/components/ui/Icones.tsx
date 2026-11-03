/** Petites icônes SVG inline, en `currentColor`, sans dépendance externe. */

type PropsIcone = {
  className?: string
}

export function IconeGrille({ className }: PropsIcone) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function IconeListe({ className }: PropsIcone) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function IconeManette({ className }: PropsIcone) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7.5 8h9a4.5 4.5 0 0 1 4.4 5.4l-.7 3.2a2.4 2.4 0 0 1-4.2 1.1L14.5 16h-5l-1.5 1.7a2.4 2.4 0 0 1-4.2-1.1l-.7-3.2A4.5 4.5 0 0 1 7.5 8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8 11v3M6.5 12.5h3M15.5 11.5h.01M17.5 13.5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function IconeBoite({ className }: PropsIcone) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5v-9Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m4 7.5 8 3.5 8-3.5M12 11v9" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

export function IconeAlerte({ className }: PropsIcone) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4 3.5 19h17L12 4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 9v4M12 16.5v.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function IconeFiltre({ className }: PropsIcone) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

export function IconeCouronne({ className }: PropsIcone) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 17h16l-1.6-9-4.1 3L12 5.5 9.7 11 5.6 8 4 17Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M6 20h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function IconeTrophee({ className }: PropsIcone) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 6H4v2a4 4 0 0 0 4 4M16 6h4v2a4 4 0 0 1-4 4M12 13v4M8 21h8M9 17h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function IconeMelange({ className }: PropsIcone) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 8h4.5l7 8H20M4 16h4.5l7-8H20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m17 5 3 3-3 3M17 13l3 3-3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
