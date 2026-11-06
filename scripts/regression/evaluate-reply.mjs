// Offline, deliberately transparent release rubric. This assesses the sales
// move and preservation of selected facts, not writing style or exact phrasing.
// Production source/authority validation remains a separate result in the runner.
const normalize = value => String(value || '').replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const escaped = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = value => value instanceof RegExp ? value : new RegExp(value, 'i');
const questionCount = line => (line.match(/\?/g) || []).length;
const checkVerb = /\b(?:check|verify|confirm|find out|look into|review|compare|investigate|determine|establish)\b/i;
const uncertainty = /\b(?:whether|if|scope|coverage|appl(?:y|ies)|match)\b/i;
const outgoing = /\b(?:send|email|forward|share|reply|respond|provide|return)\b/i;
const followup = /\b(?:follow(?:ed|ing)?[- ]?up|check(?:ed|ing)? back|call(?:ed|ing)? (?:you )?back|reconnect(?:ed|ing)?|contact(?:ed|ing)? you|(?:get|got|getting)(?: back)? in touch|touch(?:ed|ing)? base|(?:catch|caught|catching) up|speak again)\b/i;
const permission = /\b(?:would (?:it|that|you)|(?:could|can|may) (?:I|we)|is it (?:alright|all right|okay|ok)|does that work|would that work)\b/i;
const date = /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|tomorrow|next week|within \d|in \d|24[- ]?hour|ASAP|shortly|soon)\b/i;

function referencePresent(line, reference) {
  const parts = String(reference).match(/^([a-z]+)[- ]?(\d+)$/i);
  return parts ? new RegExp('\\b' + escaped(parts[1]) + '[- ]?' + escaped(parts[2]) + '\\b', 'i').test(line) : pattern(escaped(reference)).test(line);
}
function conditionalSend(line) {
  if(!outgoing.test(line) || /\b(?:regardless|anyway|whether or not|without waiting|before (?:that |the )?check|even if (?:it |the report )?(?:does not|doesn't|fails))\b/i.test(line)) return false;
  // Evaluate every outgoing commitment, rather than letting one safe initial
  // condition exempt an unconditional promise appended to the same reply.
  const units = line.split(/(?<=[.!?;])\s+|,?\s+\b(?:but|however|nevertheless|yet)\b\s*/i);
  const actualSend = /\b(?:I|we)(?:'ll| will| can| would| shall)?\s+(?:(?:also|then|only|definitely)\s+)*(?:send|email|forward|share|reply|respond|provide|return)\b|\b(?:and|then)\s+(?:(?:I|we)(?:'ll| will| can)?\s+)?(?:send|email|forward|share|reply|respond|provide|return)\b|\b(?:happy|ready|able) to (?:send|email|forward|share)\b|\b(?:report|document|it)\s+(?:will|can) be (?:sent|emailed|forwarded|shared)\b/i;
  const sends = units.filter(unit => actualSend.test(unit));
  if(!sends.length) return false;
  const scopeQuestion = /\b(?:whether|if)\b[^.!?]{0,90}\b(?:covers?|matches?|applies|covered)\b/i.test(line);
  return sends.every(unit => {
    if(scopeQuestion && /\bif it (?:does|matches|applies)\b/i.test(unit)) return true;
    for(const match of unit.matchAll(/\b(only if|if|provided(?: that)?|as long as|on condition that|once|after|when)\b/gi)) {
      const prefix = unit.slice(0, match.index);
      if(/\b(?:check|verify|confirm|determine|find out|look into)\s*$/i.test(prefix)) continue;
      const tail = unit.slice(match.index + match[0].length).split(/[,;]/)[0];
      const predicate = /\b(?:covers?|matches?|applies|covered|included in (?:its|(?:the|our|that|this) (?:inspection |material test |test )?report's) scope|within (?:its |the )?scope|positive (?:scope |coverage )?match|confirmed coverage)\b/i.exec(tail);
      if(!predicate) continue;
      const beforePredicate = tail.slice(0, predicate.index);
      if(/\b(?:not|never|doesn't|isn't|wasn't|fails?|failed|without)\b/i.test(beforePredicate)) continue;
      if(/\b(?:whether|if)\b/i.test(beforePredicate)) continue;
      return true;
    }
    return false;
  });
}
function presentCoverageClaim(line) {
  // Do not erase the rest of a sentence merely because its first clause offers
  // to investigate. An attached assertion is still a claim of present coverage.
  const clauses = line.split(/(?<=[.!?;])\s+|,?\s+\b(?:but|however|nevertheless|yet|and|because|since)\b\s*/i);
  return clauses.some(clause => {
    if(/^\s*(?:only if|if|provided(?: that)?|as long as|once|after|when)\b/i.test(clause)) return false;
    if(/^\s*(?:then\s+)?(?:send|email|forward|share|reply|respond|provide|return)\b[^.!?]*\b(?:only if|if|provided(?: that)?|as long as)\b/i.test(clause)) return false;
    if(/\b(?:I|we)(?:'ll| will| can| would)?\s+(?:send|email|forward|share|reply|respond|provide|return)\b/i.test(clause) && /\b(?:only if|if|provided(?: that)?|as long as)\b/i.test(clause)) return false;
    if(/\b(?:I|we)(?:'ll| will| can| would| need to)?\s+(?:check|verify|confirm|find out|determine|look into|review|compare|investigate|establish)\b[^.!?]{0,50}\b(?:whether|if)\b/i.test(clause)) return false;
    if(/^\s*let (?:me|us)\s+(?:find out|check|verify|confirm|determine|look into)\s+(?:whether|if)\b/i.test(clause)) return false;
    return /\b(?:(?:the|our|that|this) (?:material |inspection |test )*(?:report|document)|it)\b[^.!?]{0,45}\b(?:covers?|includes?|contains?|applies|certifies|proves)\b/i.test(clause)
      || /\b(?:[A-Z]{1,6}[- ]?\d+|(?:that |the |your )?(?:reference|product|model|code)|it)\s+(?:is|are|has been|was)\s+(?:fully )?(?:covered|included|certified)\b/i.test(clause)
      || /\b(?:[A-Z]{1,6}[- ]?\d+|(?:that |the |your )?(?:reference|product|model|code)|it)\s+(?:is|falls?)\s+within\s+(?:(?:the )?scope of (?:the |our |that |this )?(?:inspection |material test |test )?report|(?:the |our |that |this )?(?:inspection |material test |test )?report's scope)\b/i.test(clause)
      || /\bit\s+(?:definitely |certainly |already )?does\b/i.test(clause);
  });
}

export function evaluateReply(say, rubric={}) {
  const line = normalize(say), checks = [];
  const check = (name, pass, detail) => checks.push({name, pass: Boolean(pass), ...(detail ? {detail} : {})});
  check('usable wording exists', Boolean(line));
  check('no internal fields in spoken wording', !/(?:^|\s)(?:SAY|MOVE|WHY|EVIDENCE|MISSING|STAGE_ID|BUYER_INTENT)\s*:/i.test(line));
  for(const regex of rubric.mustAll || []) check('required meaning: ' + regex, pattern(regex).test(line));
  if(rubric.mustAny?.length) check('one relevant semantic alternative', rubric.mustAny.some(regex => pattern(regex).test(line)), rubric.mustAny.join(' OR '));
  for(const regex of rubric.mustNot || []) check('excluded meaning: ' + regex, !pattern(regex).test(line));
  if(rubric.preserveReference && rubric.reference) check('full buyer reference preserved', referencePresent(line, rubric.reference), rubric.reference);
  if(rubric.oneQuestion) check('one useful question', questionCount(line) === 1);
  if(rubric.acknowledgeReceipt) check('receipt recognized separately from review', /\b(?:received|receipt|got (?:the|them|both))\b/i.test(line) && !/\b(?:you|your team) (?:reviewed|approved)\b/i.test(line));

  switch(rubric.move) {
    case 'routing':
      check('polite connection request', /\b(?:could|can|may|please)\b/i.test(line) && /\b(?:connect|transfer|put me through|speak (?:to|with)|reach)\b/i.test(line));
      if(rubric.buyerName) check('intended contact named as transfer target', pattern(escaped(rubric.buyerName)).test(line) && !new RegExp('\\b(?:hi|hello|hey)[, !-]*' + escaped(rubric.buyerName) + '\\b', 'i').test(line));
      break;
    case 'introduction':
      check('rep introduces themselves or company', /\b(?:this is|it's|I am|I'm|from|with)\b/i.test(line));
      for(const term of rubric.purposeTerms || []) check('documented purpose: ' + term, pattern(term).test(line));
      if(rubric.naturalOpening) check('buyer has room to explain need', questionCount(line) === 1 || /\b(?:tell me|hear about|understand what|what brings|happy to listen)\b/i.test(line));
      break;
    case 'clarify_reference':
      check('clarify unfamiliar reference once', questionCount(line) === 1 && /\b(?:confirm|clarify|spell|reference|code|number)\b/i.test(line));
      check('does not claim coverage', !presentCoverageClaim(line));
      break;
    case 'investigate_coverage':
      check('offers to investigate unresolved scope', checkVerb.test(line) && uncertainty.test(line));
      check('does not assert current coverage', !presentCoverageClaim(line));
      check('no new generic discovery', !/\b(?:supply partner|what (?:are you|do you) looking for|current supplier|annual volume)\b/i.test(line));
      break;
    case 'conditional_send':
      check('positive coverage remains a send condition', conditionalSend(line));
      check('does not assert current coverage', !presentCoverageClaim(line));
      check('no unauthorized commercial addition', !/\b(?:ship|dispatch|certified|guarantee|discount|free of charge|at no charge)\b/i.test(line));
      check('no invented timing', !date.test(line));
      break;
    case 'discovery':
      check('one answerable discovery question', questionCount(line) === 1);
      check('not generic supplier questionnaire', !/\b(?:what are you looking for in a supply partner|annual volume|best email)\b/i.test(line));
      break;
    case 'deferral':
      check('acknowledges buyer boundary', /\b(?:of course|understood|understand|that makes sense|no problem|fair enough|certainly|absolutely|thank|thanks)\b/i.test(line));
      check('permission for practical follow-up', permission.test(line) && followup.test(line));
      check('does not repeat deferred technical discovery', !/\b(?:what|which|how)\b[^?]{0,100}\b(?:engineering|engineer|technical|specification)\b[^?]{0,70}\?/i.test(line));
      check('no invented date', !date.test(line));
      break;
    case 'email_next_step':
      check('respects drawing/email plan', /\b(?:email|e-mail|drawing)\b/i.test(line));
      check('explains useful work after drawing', /\b(?:compare|review|assess|check|match|determine|evaluate)\b/i.test(line));
      check('technical match remains open', /\b(?:whether|if|compare|assess|determine)\b/i.test(line) && !/\b(?:perfect|ideal|guaranteed|will work|is suitable)\b/i.test(line));
      check('does not repeat discovery', questionCount(line) === 0);
      check('no invented timing', !date.test(line));
      break;
    case 'approval_hold':
      check('explicitly waits for buyer approval', /\b(?:won't|will not|do not|don't|hold off|wait|until|before)\b/i.test(line) && /\bapprov/i.test(line));
      check('does not promise sending first', !/\b(?:send|email|forward)\b[^.!?]{0,50}\b(?:now|regardless|before you approve)\b/i.test(line));
      break;
    case 'close':
      check('warm confirmation or close', /\b(?:thank|thanks|good day|goodbye|take care|look out|follow up|check back|speak again)\b/i.test(line));
      check('no new discovery at close', questionCount(line) === 0);
      check('no invented timing', !date.test(line));
      break;
  }
  if(['routing', 'introduction'].includes(rubric.move)) {
    if(rubric.companyName) check('represented company identified', pattern(escaped(rubric.companyName)).test(line));
    if(rubric.repName) check('verified representative identity', pattern('\\b' + escaped(rubric.repName) + '\\b').test(line));
  }
  if(rubric.close) check('closes warmly without another question', /\b(?:thank|thanks|good day|goodbye|take care)\b/i.test(line) && questionCount(line) === 0);
  const failures = checks.filter(row => !row.pass);
  return {pass: failures.length === 0, checks, failures};
}

export default evaluateReply;

// A safety rejection and successful recovery are separate release outcomes.
// `identityProblems` comes from the tested build's production identity check;
// nothing here supplies a name or corrective line to generation instructions.
export function scoreIdentityRecovery({candidate,identityProblems,issues,publishedIdentityProblems,stableUsable,publicationCount,cardCount,providerRequests}) {
  const rejected=issues.some(issue=>issue.status==='rejected'&&issue.originalSay?.trim()===candidate.trim()&&identityProblems.some(reason=>issue.reason.includes(reason)));
  return {
    identitySafety:{tested:true,pass:identityProblems.length>0&&rejected&&publishedIdentityProblems.length===0,rejectedCandidate:candidate,reasons:identityProblems,publishedViolations:publishedIdentityProblems},
    samePressRecovery:{tested:true,pass:stableUsable&&publishedIdentityProblems.length===0&&publicationCount===1&&cardCount===1,providerRequests,publicationCount,cardCount},
  };
}
