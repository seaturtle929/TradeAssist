import assert from 'node:assert/strict';

/** Shared assertions for the new explicit press contract. The original unsafe
 * draft is still rejected, but the original press now ends with a controlled
 * local line instead of remote repair or an unavailable card. */
export function assertLocalPressCompletion(log,creates,unsafe){
 const shown=log.shown,entry=shown[0],say=typeof entry==='string'?entry:entry?.say??entry?.value?.say;
 assert.equal(shown.length,1,'An active intentional press must produce one speakable line');
 assert.ok(say?.trim(),'The local completion is nonempty');
 assert.notEqual(say,unsafe,'The rejected claim must never reach the spoken card');
 assert.doesNotMatch(say,/\b(?:guarantee|certified|ship|discount|tomorrow|right over)\b|Suggestion unavailable|\b(?:SAY|MOVE):/i);
 assert.doesNotMatch(say,/\b(?:I|we)(?:'ll| will)\s+(?:send|email|forward)\b/i,'A local check cannot introduce a sending promise');
 const traces=log.traces||[];
 assert.ok(traces.some(event=>event.event==='rejected'),'The original rejection remains diagnostic evidence');
 assert.ok(traces.some(event=>event.event==='failed'&&event.status==='locally_completed'),'The recovery is explicitly recorded as local');
 assert.equal(traces.filter(event=>event.event==='repair_requested').length,0,'No extra remote repair');
 assert.equal(creates.length,1,'No second generation for the original press');
 if(log.errors)assert.deepEqual(log.errors,[],'The spoken card does not end as unavailable');
 if(log.fallback!==undefined)assert.equal(log.fallback,0,'No remote fallback');
 if(entry?.value)assert.equal(entry.value.replyOrigin,'local');
 return say;
}
