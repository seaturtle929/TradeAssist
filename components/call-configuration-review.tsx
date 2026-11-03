import type {CallRecord} from '../lib/trade';
import {fieldEvidence} from '../lib/buyer-facts';

/** Saved manager context stays with the call; never re-read today's Brain. */
export function CallConfigurationReview({call}:{call:CallRecord}) {
 const binding=call.companyConfiguration;
 if(!binding)return <p className="context-help">Legacy call · the selected configuration version was not recorded. Its original transcript and settings are preserved.</p>;
 const stage=binding.snapshot.stages.find(item=>item.id===binding.selectedStageId);
 return <details className="transcript-details" open>
  <summary>Stage &amp; setup used · {stage?.name||binding.selectedStageId} · version {binding.version}</summary>
  <p><strong>Stage objective:</strong> {stage?.objective||'Objective unavailable in this saved snapshot.'}</p>
  <p className="context-help">{binding.boundAt>0&&Number.isFinite(binding.boundAt)?`Bound ${new Date(binding.boundAt).toLocaleString()}.`:'Setup snapshot timing was not recorded.'} Later Brain changes do not change this record. Earlier legacy turns may predate the binding.</p>
  <details><summary>Manager playbook used</summary><p className="preserve">{stage?.playbook}</p><small>{binding.versionId}</small></details>
  {!!stage?.informationToBringBack.length&&<><h3>Information to bring back</h3><ul>{stage.informationToBringBack.map(label=>{const evidence=fieldEvidence(label,call.turns);return <li key={label}><strong>{label}:</strong> {evidence?<><span>{evidence.value}</span><details><summary>Transcript evidence</summary><blockquote>{evidence.quote}</blockquote></details></>:<span>Not automatically matched · review the transcript</span>}</li>;})}</ul></>}
 </details>;
}
