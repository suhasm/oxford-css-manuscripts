import {searchMatchRanges} from './search.mjs';
// Presentation helpers only: source readings and source locations are unchanged.
const escapeUIValue = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const helpCopy = {
  'Record subtype':'A more specific description of this record’s role, such as a manuscript entry, marginal note, or continuation.',
  'Source':'A work, collection, or bibliographical reference cited in this entry. The folio link opens the handwritten catalogue page.',
  'Source as written':'A work, collection, or bibliographical reference cited in this entry, preserving the catalogue’s wording.',
  'Subject':'The topic or branch of learning identified in the catalogue. A dash means no separate subject was recorded here.',
  'Subject tags':'Subject categories assigned from titles, subject descriptions and catalogue context. Classification evidence and confidence are available in the reading notes and downloads.',
  'Tradition tags':'Textual or devotional associations of the work, separate from subject. They do not identify the religion of the author, owner or scribe. No tag means unspecified. Confidence and evidence are available in the reading notes and downloads.',
  'Classification status':'Supported means the available catalogue evidence supports the subject assignment; uncertain means at least one subject tag is inferred or ambiguous. Unclassified means insufficient evidence. None is a claim of human verification.',
  'Classification evidence':'The transcribed wording, work identification or catalogue relationship supporting each editorial tag. Uncertain classifications remain marked.',
  'Incipit':'The opening words of the catalogued text, when the catalogue quotes them.',
  'Date':'The date recorded in the catalogue, kept as written. Calendars may vary; “n.d.” means no date is recorded.',
  'Extent':'The amount of manuscript material recorded, usually a number of leaves or a folio range. “ff.” means leaves.',
  'Lines':'The line count recorded for the manuscript, usually lines per page. Unclear interpretations remain marked in the reading notes.',
  'Script':'The writing system or script abbreviation recorded by the cataloguer. Abbreviations are preserved as written.',
  'Shelfmark':'The catalogue’s reference number for a manuscript or a part of a manuscript.',
  'Folio':'The leaf of the handwritten catalogue where the record appears. A label ending in “b” identifies the reverse, or verso, of that leaf.',
  'Source image':'The image’s position in the original sequence of 690 photographs, including both sides of leaves and blank pages.',
  'Title':'The work’s title, including marked expansions of ditto references. The original wording remains in the catalogue text.',
  'Author / source':'The author or attribution written in the catalogue. Inherited or editorial associations are identified separately.',
  'Type / status':'Whether this is a manuscript holding, cross-reference, heading, continuation, or annotation, together with cancellation and uncertainty notices.',
  'Title readings / context':'The literal title, any normalized form, and any inherited work context. These remain separate readings.',
  'Normalized title':'An editorially standardized form used to help searching. The original wording remains in the catalogue text.',
  'Readable heading':'A reader-facing title that expands the catalogue’s commentary signs and includes the identified base work. The original title remains in the catalogue text; uncertain identifications are marked.',
  'Inherited readings':'Titles and other values expanded from recorded ditto links or source context. Each keeps its evidence and source reference. Probable or uncertain expansions are marked uncertain; the literal catalogue text is unchanged.',
  'Work context':'Information inherited from a heading or related entry, kept separate from words visible in this entry.',
  'Catalogue text':'The full literal transcription of this catalogue entry, including abbreviations, additions and cancellations. Strikethrough marks cancelled writing; [?] marks uncertainty.',
  'Full catalogue text':'The full literal transcription, including abbreviations, additions, cancellations and uncertain readings.',
  'Uncertain readings':'Doubtful letters, alternative readings, and unresolved attachments identified during machine review. Other errors may remain.',
  'Annotations':'Descriptions of visible features such as ticks, arrows, additions, cancellations and marginal writing.',
  'Relationships':'Connections proposed between this record and other entries or headings. Each connection retains its evidence and degree of certainty.',
  'Review notes':'Observations made while checking the transcription against its source image.',
  'Editorial notes':'Explanations or search associations added during processing, kept separate from the catalogue’s literal wording.',
  'Amended readings':'Applied corrections showing the earlier reading, the replacement, and the reviewer’s reason. The original output remains in the downloadable transcription history.',
  'Record':'A stable identifier for this transcription record, used in downloads and the audit trail.'
};

export function fieldHelpHTML(label, iconOnly=false) {
  const explanation=helpCopy[label];
  if(iconOnly)return '';
  if(!explanation)return escapeUIValue(label);
  return `<button type="button" class="field-help" data-field-help="${escapeUIValue(explanation)}" aria-label="Explain ${escapeUIValue(label)}" aria-expanded="false"><span>${escapeUIValue(label)}</span></button>`;
}

export function fieldHelpAttributes(label){
  return helpCopy[label]?`data-field-help="${escapeUIValue(helpCopy[label])}" data-help-passive="true"`:'';
}

export function highlightSearchResults(root,query){
  root.querySelectorAll('mark.search-hit').forEach(mark=>mark.replaceWith(document.createTextNode(mark.textContent)));root.normalize();
  if(query.trim()){
    const selectors='.entry-title,.entry-author,.entry-work-context,.entry-original-value,.entry-metadata dd,.entry-shelfmark,.transcription,.entry-note-section li,.catalogue-spreadsheet td';
    for(const container of root.querySelectorAll(selectors)){
      const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT),nodes=[];let content='';
      while(walker.nextNode()){const node=walker.currentNode;nodes.push({node,offset:content.length});content+=node.nodeValue;}
      const matches=searchMatchRanges(content,query);if(!matches.length)continue;
      for(const {node,offset} of nodes){
        const text=node.nodeValue,ranges=matches.filter(([start,stop])=>start<offset+text.length&&stop>offset).map(([start,stop])=>[Math.max(0,start-offset),Math.min(text.length,stop-offset)]);if(!ranges.length)continue;
        const fragment=document.createDocumentFragment();let end=0;
        for(const [start,stop] of ranges){
          fragment.append(document.createTextNode(text.slice(end,start)));
          const mark=document.createElement('mark');mark.className='search-hit';mark.textContent=text.slice(start,stop);fragment.append(mark);end=stop;
        }
        fragment.append(document.createTextNode(text.slice(end)));node.replaceWith(fragment);
      }
    }
  }
  for(const article of root.querySelectorAll('.catalogue-entry')){
    const count=article.querySelector('.entry-notes')?.querySelectorAll('mark.search-hit').length||0;
    const badge=article.querySelector('[data-note-hit-count]');if(!badge)continue;
    badge.hidden=!count;badge.textContent=count?`${count} hit${count===1?'':'s'}`:'';
    badge.setAttribute('aria-label',`${count} search matches in readings and editorial notes`);
  }
}

let entryImageCounter=0;
export function entryImageControlsHTML(record) {
  const id=`entry-image-${++entryImageCounter}-${record.id}`;
  return `<div class="entry-image-controls"><button type="button" class="entry-image-toggle" data-entry-crop="${escapeUIValue(record.id)}" aria-controls="${escapeUIValue(id)}" aria-expanded="false" aria-label="Show entry image">Image</button><div class="entry-image-panel" id="${escapeUIValue(id)}" hidden></div></div>`;
}

// Keep separated marginal material in separate crops rather than spanning other
// entries. Nearby blocks on the same lines can share a single source crop.
export function getEntryCropRegions(record, page, padding=18) {
  const [width,height]=page?.native_dimensions||[];
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return [];
  const boxes=(record.locations||[]).map(l=>l.bbox).filter(b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[2]>0&&b[3]>0)
    .map(([x,y,w,h])=>({left:Math.max(0,Math.floor(x)),top:Math.max(0,Math.floor(y)),right:Math.min(width,Math.ceil(x+w)),bottom:Math.min(height,Math.ceil(y+h))}))
    .filter(b=>b.right>b.left&&b.bottom>b.top).sort((a,b)=>a.top-b.top||a.left-b.left);
  const groups=[];
  for(const box of boxes){
    const previous=groups.at(-1);
    if(previous&&box.top<=previous.bottom+32){
      previous.left=Math.min(previous.left,box.left);previous.right=Math.max(previous.right,box.right);previous.bottom=Math.max(previous.bottom,box.bottom);
    }else groups.push({...box});
  }
  return groups.map(b=>{
    const x=Math.max(0,b.left-padding),y=Math.max(0,b.top-padding);
    return [x,y,Math.min(width,b.right+padding)-x,Math.min(height,b.bottom+padding)-y];
  });
}

export function entryCropURL(page, region) {
  return page?.image_mode==='bundled_local'?page.sourceImageURL:'';
}

let activeHelpControl=null, helpPinned=false;
export function hideCatalogueHelp() {
  const tip=document.getElementById('field-tooltip');if(tip)tip.hidden=true;
  if(activeHelpControl){activeHelpControl.setAttribute('aria-expanded','false');activeHelpControl.removeAttribute('aria-describedby');}
  activeHelpControl=null;helpPinned=false;
}

export function setupCatalogueUsability(catalogue) {
  const records=new Map(catalogue.records.map(r=>[r.id,r]));
  const pages=new Map(catalogue.pages.map(p=>[p.source_order,p]));
  const tip=document.createElement('div');tip.id='field-tooltip';tip.className='field-tooltip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);
  function showHelp(button,pinned=false){
    hideCatalogueHelp();activeHelpControl=button;helpPinned=pinned;
    tip.textContent=button.dataset.fieldHelp;tip.hidden=false;
    button.setAttribute('aria-describedby',tip.id);button.setAttribute('aria-expanded','true');
    const box=button.getBoundingClientRect(),tw=tip.offsetWidth||300,th=tip.offsetHeight||110;
    tip.style.left=Math.max(12,Math.min(box.left,window.innerWidth-tw-12))+'px';
    tip.style.top=Math.max(12,box.bottom+8+th<=window.innerHeight-12?box.bottom+8:box.top-th-8)+'px';
  }
  document.addEventListener('pointerover',event=>{
    const button=event.target.closest('[data-field-help]');
    if(button&&button!==activeHelpControl)showHelp(button);
  });
  document.addEventListener('pointerout',event=>{
    if(!activeHelpControl||helpPinned||document.activeElement===activeHelpControl)return;
    const next=event.relatedTarget;
    if(next&&(activeHelpControl.contains(next)||tip.contains(next)))return;
    if(activeHelpControl.contains(event.target)||tip.contains(event.target))hideCatalogueHelp();
  });
  document.addEventListener('focusin',event=>{const button=event.target.closest('[data-field-help]');if(button)showHelp(button);});
  document.addEventListener('focusout',event=>{if(activeHelpControl===event.target)hideCatalogueHelp();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&activeHelpControl){event.preventDefault();hideCatalogueHelp();}});
  document.addEventListener('scroll',hideCatalogueHelp,true);window.addEventListener('resize',hideCatalogueHelp);
  document.addEventListener('click',event=>{
    const help=event.target.closest('[data-field-help]');
    if(help?.dataset.helpPassive){hideCatalogueHelp();return;}
    if(help){if(activeHelpControl===help&&helpPinned)hideCatalogueHelp();else showHelp(help,true);return;}
    if(!tip.contains(event.target))hideCatalogueHelp();
    const notesButton=event.target.closest('[data-notes-toggle]');
    if(notesButton){
      const panel=document.getElementById(notesButton.getAttribute('aria-controls'));
      const open=notesButton.getAttribute('aria-expanded')==='true';
      panel.hidden=open;notesButton.setAttribute('aria-expanded',String(!open));return;
    }
    const button=event.target.closest('[data-entry-crop]');if(!button)return;
    const panel=document.getElementById(button.getAttribute('aria-controls'));
    const expanded=button.getAttribute('aria-expanded')==='true';
    button.setAttribute('aria-expanded',String(!expanded));button.textContent=expanded?'Image':'Hide image';button.setAttribute('aria-label',expanded?'Show entry image':'Hide entry image');panel.hidden=expanded;
    if(expanded||panel.dataset.loaded)return;
    const record=records.get(button.dataset.entryCrop),page=pages.get(record?.source_order);
    const regions=record?getEntryCropRegions(record,page):[];
    const fullLink=page?`<a href="?page=${page.source_order}" data-open-folio="${page.source_order}" data-record="${escapeUIValue(record.id)}">View whole folio ↗</a>`:'';
    panel.dataset.loaded='true';
    if(!regions.length){panel.innerHTML=`<p class="entry-image-message">This record has no usable crop location. ${fullLink}</p>`;return;}
    panel.innerHTML=`<p class="entry-image-caption">${escapeUIValue(page.folio_label)} · approximate entry bounds${regions.length>1?' · separate parts of the entry':''}. ${fullLink}</p>`+
      regions.map((region,index)=>{
        const url=entryCropURL(page,region),[x,y,width,height]=region;
        return `<figure class="entry-crop-figure"><div class="entry-crop-frame" style="aspect-ratio:${width}/${height}"><img class="entry-crop-image" width="${width}" height="${height}" alt="Handwritten entry ${escapeUIValue(record.shelfmark||record.displayTitle||record.id)}, ${escapeUIValue(page.folio_label)}${regions.length>1?', part '+(index+1):''}"></div><figcaption><span class="entry-crop-status" role="status">Loading entry image…</span><a href="${escapeUIValue(url)}" target="_blank" rel="noopener noreferrer">Open bundled folio ↗</a><a href="${escapeUIValue(page.originalSourceImageURL)}" target="_blank" rel="noopener noreferrer">High-resolution at the Bodleian ↗</a></figcaption></figure>`;
      }).join('');
    panel.querySelectorAll('.entry-crop-image').forEach((img,index)=>{
      const region=regions[index],status=img.closest('figure').querySelector('.entry-crop-status');
      const [cropX,cropY,cropW,cropH]=region;
      Object.assign(img.style,{position:'absolute',width:(page.native_dimensions[0]/cropW*100)+'%',height:'auto',maxWidth:'none',left:(-cropX/cropW*100)+'%',top:(-cropY/cropH*100)+'%'});
      img.addEventListener('load',()=>{status.textContent=img.dataset.fallback?'Offline preview · lower resolution':`Bundled-image crop · ${page.bundled_dimensions[1].toLocaleString()} px source height · below native resolution`;});
      img.addEventListener('error',()=>{
        if(img.dataset.fallback){img.hidden=true;status.textContent='Image unavailable. Use the whole-folio link.';return;}
        img.dataset.fallback='true';status.textContent='Loading local preview…';
        const [x,y,width,height]=region;
        Object.assign(img.style,{position:'absolute',width:(page.native_dimensions[0]/width*100)+'%',height:'auto',maxWidth:'none',left:(-x/width*100)+'%',top:(-y/height*100)+'%'});
        img.src=page.imagePath;
      });
      img.src=entryCropURL(page,region);
    });
  });
}
