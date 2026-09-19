// Shown when the view settles with no content on screen.
export default function BackPill({ onClick }) {
  return (
    <button className="dc-backto" onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 4 12l7 7" /><path d="M4 12h15" />
      </svg>
      Back to content
    </button>
  );
}
