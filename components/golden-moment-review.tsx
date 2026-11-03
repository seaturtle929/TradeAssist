import { useId, useRef, useState, type FormEvent } from 'react';
import type { CallRecord, Manufacturer } from '../lib/trade';
import type { SuggestionRecord } from '../lib/phase1-types';
import {
  createGoldenMomentSnapshot, draftGeneralPattern, generalPatternTemplateIssue, retrieveGeneralPattern, GOLDEN_WHY_TAGS, MAX_GOLDEN_EXPLANATION_LENGTH, MAX_GENERAL_PATTERN_LENGTH,
  type GeneralPlaybookRecord, type GoldenMoment, type GoldenMomentSnapshot, type GoldenWhyTag, type GoldenPatternReview,
} from '../lib/general-playbook';
import './golden-moment-review.css';

type GoldenMomentReviewProps = {
  call: CallRecord;
  company: Manufacturer;
  suggestion: SuggestionRecord;
  playbook: GeneralPlaybookRecord;
  disabled?: boolean;
  saved?: boolean;
  onSave: (snapshot: GoldenMomentSnapshot, learningExplanation: string, why?: GoldenWhyTag, patternReview?: GoldenPatternReview) => void | Promise<void>;
};

const dateLabel = (timestamp: number) => Number.isFinite(timestamp) && timestamp > 0
  ? new Date(timestamp).toLocaleString()
  : 'Timestamp unavailable';
const momentDateLabel = (snapshot: GoldenMomentSnapshot) => snapshot.timestampKnown === false
  ? `Imported ${dateLabel(snapshot.importedAt || snapshot.timestamp)} · original call time unknown`
  : dateLabel(snapshot.timestamp);

function SnapshotFields({ snapshot }: { snapshot: GoldenMomentSnapshot }) {
  const context = snapshot.previousContext.map(turn => `${turn.role === 'you' ? 'You' : turn.role === 'buyer' ? 'Buyer' : 'Call audio'}: ${turn.text}`).join('\n');
  return <dl className="golden-moment-snapshot">
    <div className="golden-moment-wide"><dt>Buyer line</dt><dd className={!snapshot.buyerLine ? 'golden-moment-empty' : undefined}>{snapshot.buyerLine || 'No buyer line recorded'}</dd></div>
    <div className="golden-moment-wide"><dt>Previous context</dt><dd className={!context ? 'golden-moment-empty' : undefined}>{context || 'No earlier context recorded'}</dd></div>
    <div><dt>Stage</dt><dd>{snapshot.stageId || 'Stage not recorded'}</dd></div>
    <div><dt>{snapshot.timestampKnown === false ? 'Import timestamp' : 'Timestamp'}</dt><dd>{momentDateLabel(snapshot)}</dd></div>
    {snapshot.provenance === 'user_provided_retrospective' && <div className="golden-moment-wide"><dt>Source</dt><dd>User-provided retrospective example</dd></div>}
    <div className="golden-moment-wide"><dt>Copilot suggestion</dt><dd className={!snapshot.copilotSuggestion ? 'golden-moment-empty' : undefined}>{snapshot.copilotSuggestion || 'No suggestion recorded'}</dd></div>
    <div className="golden-moment-wide"><dt>Rep override</dt><dd className={!snapshot.repOverride ? 'golden-moment-empty' : undefined}>{snapshot.repOverride || 'No rep override recorded'}</dd></div>
  </dl>;
}

/** Company learning can be saved independently of an optional shared pattern. */
export function GoldenMomentReview({ call, company, suggestion, playbook, disabled = false, saved = false, onSave }: GoldenMomentReviewProps) {
  const [snapshot, setSnapshot] = useState<GoldenMomentSnapshot | null>(null);
  const [why, setWhy] = useState<GoldenWhyTag | ''>('');
  const [learningExplanation,setLearningExplanation] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [patternTemplate, setPatternTemplate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const id = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const pattern = snapshot ? draftGeneralPattern(snapshot, company) : null;
  const patternIssue = pattern ? generalPatternTemplateIssue(patternTemplate) : null;
  const wrongCompany = call.manufacturerId !== company.id;
  const isSaved = saved || complete || !!company.brain?.goldenMoments?.some(moment => moment.callId === call.id && moment.suggestionId === suggestion.id);

  function openReview() {
    if (disabled || wrongCompany || isSaved) return;
    try {
      const nextSnapshot = createGoldenMomentSnapshot(call, suggestion, company);
      const draft = draftGeneralPattern(nextSnapshot, company);
      setSnapshot(nextSnapshot);
      setPatternTemplate(draft ? retrieveGeneralPattern(playbook,draft.momentType)?.template || draft.template : '');
      setWhy(''); setLearningExplanation(''); setConfirmed(false); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'This call moment could not be opened.'); }
  }

  function closeReview() {
    if (saving) return;
    setSnapshot(null); setError('');
    opener.current?.focus();
  }

  async function saveReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot || !learningExplanation.trim() || (pattern && confirmed && patternIssue) || saving || disabled || wrongCompany) return;
    setSaving(true); setError('');
    try { await onSave(snapshot, learningExplanation.trim(), why || undefined, pattern && confirmed ? { template: patternTemplate.trim() } : undefined); setComplete(true); setSnapshot(null); opener.current?.focus(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Golden Moment could not be saved.'); }
    finally { setSaving(false); }
  }

  return <div className="golden-moment-action">
    <button type="button" ref={opener} className="button secondary small" aria-expanded={!!snapshot} aria-controls={`${id}-review`} disabled={disabled || wrongCompany || isSaved} onClick={openReview}>{isSaved ? 'Golden Moment saved' : 'Save as Golden Moment'}</button>
    {wrongCompany && <p className="golden-moment-error" role="status">Open this call’s company to review its Golden Moments.</p>}
    {error && !snapshot && <p className="golden-moment-error" role="alert">{error}</p>}
    {complete && <p className="golden-moment-status" role="status">Golden Moment saved to {company.name}’s Brain.</p>}
    {snapshot && <section id={`${id}-review`} className="golden-moment-review" aria-labelledby={`${id}-title`} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeReview(); } }}>
      <header><div><h3 id={`${id}-title`}>Review Golden Moment</h3><p>These details are filled from the saved call and its recorded feedback.</p></div><button type="button" className="text-button" onClick={closeReview} disabled={saving} aria-label="Close Golden Moment review">Close</button></header>
      <SnapshotFields snapshot={snapshot}/>
      <form onSubmit={event => void saveReview(event)}>
        <label className="golden-moment-why" htmlFor={`${id}-explanation`}>Why should the copilot learn from this moment?
          <textarea id={`${id}-explanation`} required rows={4} maxLength={MAX_GOLDEN_EXPLANATION_LENGTH} value={learningExplanation} disabled={saving || disabled} aria-describedby={`${id}-explanation-help`} placeholder="Explain what went wrong and what the copilot should do in a similar situation next time…" onChange={event=>setLearningExplanation(event.target.value)}/>
        </label>
        <p id={`${id}-explanation-help`}>Your explanation is saved with this company’s moment and retrieved in similar situations. It guides the response; product facts still need Company Knowledge. {learningExplanation.length}/{MAX_GOLDEN_EXPLANATION_LENGTH}</p>
        <label className="golden-moment-why" htmlFor={`${id}-why`}>Category (optional)
          <select id={`${id}-why`} value={why} disabled={saving || disabled} onChange={event => setWhy(event.target.value as GoldenWhyTag | '')}>
            <option value="">No category</option>{GOLDEN_WHY_TAGS.map(tag => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        </label>
        {pattern ? <><div className="golden-pattern-preview" aria-labelledby={`${id}-pattern-title`}>
          <h4 id={`${id}-pattern-title`}>General pattern · Interest-Narrowed (optional)</h4>
          <p>Your correction and handwritten explanation stay in {company.name}’s Brain. Their general move also strengthens the shared foundation without company facts. Editing and sharing this exact reusable wording is optional.</p>
          <label className="golden-moment-why" htmlFor={`${id}-pattern`}>Reusable wording
            <textarea id={`${id}-pattern`} rows={3} maxLength={MAX_GENERAL_PATTERN_LENGTH} value={patternTemplate} disabled={saving || disabled} aria-describedby={`${id}-pattern-help`} onChange={event=>{setPatternTemplate(event.target.value);setConfirmed(false);}}/>
          </label>
          <p id={`${id}-pattern-help`}>Keep {'{selected_item}'} once. You may use {'{relevant_value}'} and {'{useful_next_action}'}. {'{item_documents}'} and {'{email_action}'} are optional and apply to an agreed send. Company facts and buyer details stay in the company’s Brain.</p>
          {patternIssue && <p className="golden-pattern-validation" role="status">{patternIssue} You can still save the company moment with sharing off.</p>}
        </div>
        <label className="golden-pattern-confirm"><input type="checkbox" checked={confirmed} disabled={saving || disabled} onChange={event => setConfirmed(event.target.checked)}/><span>Also share this exact placeholder wording. I confirm it fits this moment and similar situations across companies.</span></label></> : <div className="golden-pattern-preview"><h4>Company Golden Moment</h4><p>This moment does not match a supported general pattern yet. Save its recorded example to {company.name}’s Brain.</p></div>}
        <div className="golden-moment-actions"><button type="submit" className="button primary small" disabled={!learningExplanation.trim() || (!!pattern && confirmed && !!patternIssue) || saving || disabled}>{saving ? 'Saving…' : pattern && confirmed ? 'Save Golden Moment + general pattern' : 'Save company Golden Moment'}</button><button type="button" className="text-button" onClick={closeReview} disabled={saving}>Cancel</button></div>
        {error && <p className="golden-moment-error" role="alert">{error}</p>}
      </form>
    </section>}
  </div>;
}

export function GeneralPlaybookPanel({ playbook, company, goldenMoments }: { playbook: GeneralPlaybookRecord; company?: Manufacturer; goldenMoments?: GoldenMoment[] }) {
  const companyMoments = company ? (goldenMoments || company.brain?.goldenMoments || []).filter(moment => moment.companyId === company.id).sort((a, b) => b.timestamp - a.timestamp) : [];
  return <section className="general-playbook-panel" aria-label="General Playbook">
    <div className="general-playbook-heading"><div><span className="eyebrow">SHARED SALES PATTERNS</span><h2>General Playbook</h2></div></div>
    <p>Reusable conversation moves are shared across companies. The copilot fills their placeholders with the active company’s supported facts.</p>
    {playbook.patterns.map(pattern => <article className="general-playbook-pattern" key={pattern.id} data-testid="general-playbook-pattern"><h4>{pattern.name}</h4><p>Recognize the picked item, explain supported relevance, and choose a useful next move. Documents and email fit an agreed send.</p><pre className="golden-pattern-template">{pattern.template}</pre><small>{pattern.reviewCount} confirmed {pattern.reviewCount === 1 ? 'review' : 'reviews'} · {pattern.origin === 'seed' ? 'Imported general pattern' : 'Confirmed in post-call review'}</small></article>)}
    {!playbook.patterns.length && <p>No general pattern saved yet.</p>}
    {company && <><h3>{company.name} · Golden Moments</h3><p>These call examples belong to this company’s Brain.</p>{!companyMoments.length && <p>Save a Golden Moment from a call’s Coaching history to add one here.</p>}{companyMoments.map(moment => <details className="company-golden-moment" key={moment.id} data-testid="company-golden-moment"><summary>{moment.provenance === 'user_provided_retrospective' ? 'User-provided retrospective example · ' : ''}{momentDateLabel(moment)}{moment.why ? ` · ${moment.why}` : ''}</summary><SnapshotFields snapshot={moment}/>{moment.learningExplanation&&<div className="golden-moment-lesson"><strong>Your explanation</strong><p>{moment.learningExplanation}</p></div>}<small>{moment.generalPatternId ? `General pattern: ${playbook.patterns.find(pattern => pattern.id === moment.generalPatternId)?.name || moment.generalPatternId}` : 'Company example; no shared pattern confirmed.'}</small></details>)}</>}
  </section>;
}
