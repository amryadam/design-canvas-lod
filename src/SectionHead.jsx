import { memo } from 'react';

// The page name and the "N screens · N variants" line, above the content.
function SectionHead({ data }) {
  return (
    <div className="dc-sectionhead">
      <div className="dc-headtitle">{data.name}</div>
      {data.subtitle && <div className="dc-headsub">{data.subtitle}</div>}
    </div>
  );
}
export default memo(SectionHead);
