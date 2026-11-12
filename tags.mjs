// Editorial subject classification, kept separate from the literal subject field.
export function classificationTagLabel(tag){return tag.label+(tag.confidence==='uncertain'?' · uncertain':'');}
export function classificationEvidence(record){
 const c=record.classification;if(!c)return [];
 return [...c.subjects,...c.traditions].map(tag=>`${classificationTagLabel(tag)}: ${tag.evidence.map(e=>e.text).join(' | ')}`).concat(c.notes||[]);
}
export function classificationFilter(record,subjectTags=[],traditionTags=[]){
 const c=record.classification;
 if(!c)return !subjectTags.length&&!traditionTags.length;
 if(subjectTags.length&&!subjectTags.some(id=>c.subjects.some(tag=>tag.id===id)))return false;
 if(traditionTags.length&&!traditionTags.some(id=>c.traditions.some(tag=>tag.id===id)))return false;
 return true;
}
export function classificationHTML(record,escape){
 const c=record.classification;if(!c)return '';
 function badges(tags,dimension){return tags.map(tag=>{
  const evidence=tag.evidence.map(e=>e.text).join(' | ');
  if(dimension==='subject')return `<span class="classification-tag" title="${escape(evidence)}">${escape(tag.label)}</span>`;
  return `<button type="button" class="classification-tag" data-filter-${dimension}-tag="${escape(tag.id)}" title="${escape(evidence)}" aria-label="Filter by ${escape(tag.label)}">${escape(tag.label)}</button>`;
 }).join('');}
 return `<div class="entry-classification" aria-label="Editorial classification"><div class="classification-row"><span class="classification-label">Subject tags</span>${c.subjects.length?badges(c.subjects,'subject'):'<span class="classification-unassigned">Unclassified · insufficient evidence</span>'}</div>${c.traditions.length?`<div class="classification-row"><span class="classification-label">Tradition</span>${badges(c.traditions,'tradition')}</div>`:''}</div>`;
}
