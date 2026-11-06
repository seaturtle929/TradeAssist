import type {CoachingContext} from './call-coaching';
import {configurationReferences} from './company-configuration.ts';
import {analyzeDocumentActionMeaning,documentActionGroups,requestsDocumentProductCoverage} from './document-product-evidence.ts';
import {buyerConversationIdentifierReferences,buyerProductIdentifierReferences,buyerReferenceExplicitlyConfirmed,buyerSpelledIdentifierClarificationReferences,isBuyerIdentifierClarification,productIdentityReferences} from './product-identity-evidence.ts';

const escaped=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const normalize=(text:string)=>text.replace(/[’‘]/g,"'");
const confirmationQuestion=(text:string)=>!/\b(?:phone|telephone|callback|contact|e-?mail|order|report|cert(?:ificate|ification)?|account)\s+(?:number|code|identifier|reference)\b/i.test(text)
 &&/\b(?:confirm|repeat|spell|say (?:that|it) again)\b/i.test(text)
 &&(/\b(?:model|product|part|code|identifier|reference)\b/i.test(text)||/\brepeat\s+(?:that|the)\s+number\b/i.test(text));
const spokenDigits:Record<string,string>={zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9'};
function spelledReplyConfirms(identifier:string,text:string):boolean {
 const parts=identifier.replace(/[^A-Za-z0-9]/g,'').split('').map(char=>{
  if(/[A-Za-z]/.test(char))return escaped(char)+'(?:\\s+as in\\s+[A-Za-z]+(?:-[A-Za-z]+)*)?';
  const word=Object.keys(spokenDigits).find(key=>spokenDigits[key]===char);
  return '(?:'+char+'|'+word+')';
 });
 // A spelling answer must actually spell the complete identifier, not merely
 // echo a fragment or mention some unrelated person's spelling.
 const match=new RegExp('\\b'+parts.join('[\\s,\\-–—]+')+'\\b','i').exec(text);
 return !!match&&!/\b(?:no|not|instead)\b[^.!?]{0,35}$/i.test(text.slice(0,match.index));
}
function attachedSpellingConfirms(identifier:string,text:string):boolean {
 const spelling=new RegExp(escaped(identifier)+'(?=[\\s,])\\s*,?\\s*(?:(?:which is|it is|it\\x27s|is)\\s+)?(?:spelled|spelling is|letters are)\\s*[:,-]?\\s*(.*)$','i').exec(text)?.[1];
 if(!spelling)return false;
 const expected=identifier.replace(/[^A-Za-z0-9]/g,'').toUpperCase();let heard='';
 for(const token of spelling.match(/[A-Za-z0-9]+/g)||[]){
  const part=spokenDigits[token.toLowerCase()]||(/^(?:[A-Za-z]|\d+)$/.test(token)?token.toUpperCase():'');
  if(!part)return false;heard+=part;
  if(heard.length>=expected.length)return heard===expected;
 }
 return false;
}

/** Recognition and evidence are separate: an unfamiliar spoken code might be
 * a customer's real part, not a catalog error. Ask once rather than silently
 * substituting a familiar model. Explicit buyer confirmation resolves only
 * the spelling, never product ownership or document coverage. */
function explicitlyConfirmed(identifier:string,turns:NonNullable<CoachingContext['turns']>):boolean {
 if(buyerReferenceExplicitlyConfirmed(identifier,turns))return true;
 const literal=escaped(identifier);
 for(let index=0;index<turns.length;index++){
  const turn=turns[index];if(turn.role!=='buyer'||turn.transcriptionUncertainty)continue;
  const text=normalize(turn.text),previous=turns[index-1];
  if(previous?.role==='you'&&!previous.transcriptionUncertainty&&confirmationQuestion(previous.text)&&/^\s*(?:yes|correct|right|exactly)\b/i.test(text)&&spelledReplyConfirms(identifier,text))return true;
  if(!text.includes(identifier))continue;
  const declaration=new RegExp('\\b(?:(?:the|our|my)\\s+)?(?:model|part|product)(?:\\s+(?:code|number|identifier))?\\s+is\\s+["“]?'+literal+'(?=$|[\\s,.!?"”])','i');
  const customerPart=new RegExp(literal+'\\s+is\\s+(?:(?:our|my|the)\\s+)?(?:internal\\s+|customer\\s+)?(?:part|model|product)\\s+(?:code|number|identifier)\\b','i');
  if(declaration.test(text)||customerPart.test(text))return true;
  const echo=new RegExp('^\\s*(?:(?:yes|correct|right|exactly)[,.!\\s]+)?(?:(?:it|that)(?:\\x27s| is)\\s+)?'+literal+'(?=$|[\\s,.!?])','i');
  if(previous?.role==='you'&&!previous.transcriptionUncertainty&&confirmationQuestion(previous.text)&&echo.test(text))return true;
  if(attachedSpellingConfirms(identifier,text))return true;
 }
 return false;
}

export function buyerIdentifierConfirmation(context:CoachingContext):{identifiers:string[];buyerText:string}|undefined {
 const session=context.coachingRequest?.listeningSession;
 if(!session||['partial','pending'].includes(context.coachingRequest?.transcriptState||''))return;
 const turns=context.turns||[],latest=[...turns].reverse().find(turn=>turn.role==='buyer');
 if(!latest||latest.transcriptionUncertainty||!session.currentTurnIds.includes(latest.id||'')||!requestsDocumentProductCoverage(latest.text))return;
 const sources=context.companyConfiguration?configurationReferences(context.companyConfiguration.snapshot):context.sources||[];
 const references=buyerProductIdentifierReferences(latest.text,latest.text),known=productIdentityReferences(latest.text,sources);
 // A listening restart does not begin a new call. Keep an actual spelling
 // confirmation from earlier in this call, while the request above must
 // still belong to the current listening session. Stored buyer history is
 // deliberately absent: it cannot confirm what this caller just said.
 const identifiers=[...new Set(references.filter(reference=>!known.some(item=>item.start===reference.start&&item.end===reference.end)&&!explicitlyConfirmed(reference.text,turns)).map(reference=>reference.text))];
 return identifiers.length?{identifiers,buyerText:latest.text}:undefined;
}

/** A literal mention is not current authority after the buyer corrects it.
 * Track explicit reference corrections separately from report coverage: “not
 * QZ73” can retire a code, whereas “does not cover QZ73” does not retire it.
 * A later explicit instruction can restore a previously withdrawn reference. */
function withdrawnBuyerReferences(turns:NonNullable<CoachingContext['turns']>):Set<string>{
 const withdrawn=new Set<string>(),key=(text:string)=>text.replace(/[-\u2010-\u2015\u2212\uFE63\uFF0D]/g,'').toUpperCase();
 for(const turn of turns){
  if(turn.role!=='buyer'||turn.transcriptionUncertainty)continue;
  const line=normalize(turn.text);
  for(const reference of buyerProductIdentifierReferences(line,line)){
   const before=line.slice(0,reference.start),after=line.slice(reference.end);
   const replaced=/\b(?:don't|do not|never)\s+use\s*$|\bstop\s+using\s*$/i.test(before)
    ||/\b(?:not|rather than|instead of)\s*$/i.test(before)&&/\b(?:reference|drawing|code|correct|correction|meant|instead|old|wrong)\b/i.test(line)
    ||/^\s+(?:is|was)\s+(?:(?:the|our|my)\s+)?(?:old|wrong|incorrect|previous)\s+(?:(?:drawing|part|product)\s+)?(?:code|reference|number)\b/i.test(after);
   const selected=/\b(?:correct|new|actual|current|updated)\s+(?:(?:drawing|part|product)\s+)?(?:reference|code|number)\s+is\s*$/i.test(before)||/\b(?:use|I meant|we meant)\s*$/i.test(before);
   if(replaced)withdrawn.add(key(reference.text));else if(selected)withdrawn.delete(key(reference.text));
  }
 }
 return withdrawn;
}

export function buyerIdentifierConfirmationProblems(say:string,context:CoachingContext):string[]{
 const sources=context.companyConfiguration?configurationReferences(context.companyConfiguration.snapshot):context.sources||[];
 const turns=context.turns||[],buyers=turns.filter(turn=>turn.role==='buyer'&&!turn.transcriptionUncertainty);
 const hasConfirmedReference=buyers.some(turn=>buyerProductIdentifierReferences(turn.text,turn.text).some(reference=>explicitlyConfirmed(reference.text,turns)));
 const problems:string[]=[];
 if(hasConfirmedReference){
  // A future inquiry asserts no coverage, but it must still concern the
  // buyer's actual reference. Do not let a typo inherit the fast inquiry
  // path. Literal buyer references/confirmed typography and approved source
  // identities are allowed; an invented adjacent code is neither of those.
  const buyerAllowed=[...buyers.flatMap(turn=>buyerProductIdentifierReferences(say,turn.text)),...buyerConversationIdentifierReferences(say,turns)],known=productIdentityReferences(say,sources);
  const inquirySpans=documentActionGroups(say,context).filter(part=>analyzeDocumentActionMeaning(part.text,context).locallyNonAssertive).map(part=>({start:part.start,end:part.end}));
  const withdrawn=withdrawnBuyerReferences(turns);
  const changed=buyerProductIdentifierReferences(say,say).filter(reference=>withdrawn.has(reference.text.replace(/[-\u2010-\u2015\u2212\uFE63\uFF0D]/g,'').toUpperCase())||!buyerAllowed.some(item=>item.start===reference.start&&item.end===reference.end)&&(inquirySpans.some(span=>span.start<=reference.start&&span.end>=reference.end)||!known.some(item=>item.start===reference.start&&item.end===reference.end)));
  if(changed.length)problems.push('Preserve the buyer’s complete confirmed drawing/product reference. These proposed inquiry codes do not match the buyer’s actual words: '+[...new Set(changed.map(reference=>reference.text))].join(', ')+'. Do not substitute a similar code even when that code exists in the company catalogue.');
 }
 const uncertainty=buyerIdentifierConfirmation(context);if(!uncertainty)return problems;
 const narrowQuestion=say.includes('?')&&(confirmationQuestion(say)||/\b(?:did you say|was (?:that|it))\b/i.test(say)||/\bspell\b/i.test(say)&&uncertainty.identifiers.some(identifier=>say.includes(identifier))||say.split(/(?<=[.!?])\s+/).some(part=>isBuyerIdentifierClarification(part,uncertainty.buyerText)));
 // The buyer-reference helper is deliberately narrow (and excludes owned
 // noun phrases). Also inspect source-known codes so a leading clarification
 // question cannot smuggle in a different catalog item in another grammar.
 const spellings=buyerSpelledIdentifierClarificationReferences(say,uncertainty.buyerText);
 const mentionedCodes=[...buyerProductIdentifierReferences(say,say),...productIdentityReferences(say,sources)].filter(reference=>!spellings.some(spelling=>spelling.start<=reference.start&&spelling.end>=reference.end));
 const guessedCode=mentionedCodes.some(reference=>!uncertainty.buyerText.includes(reference.text));
 return narrowQuestion&&!guessedCode?problems:[...problems,'The current spoken report request contains a model/part code not established by the supplied company sources: '+uncertainty.identifiers.join(', ')+'. Confirm or ask for the spelling before committing to check that item; do not silently replace it with a similar catalog code, treat it as a confirmed company product, or declare it nonexistent.'];
}
