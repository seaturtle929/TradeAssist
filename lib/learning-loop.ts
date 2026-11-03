import type {Manufacturer,CallRecord,Turn} from './trade';
import type {LearningPair,RetrievedExample} from './company-brain';
import {ensureCompanyBrain} from './company-brain.ts';
import {deriveConversationState,type ConversationState} from './conversation-state.ts';
import {normalizeCallContext,defaultCallContext} from './call-purpose.ts';
import {coreFoundationMoveFor,normalizeGeneralFoundation,FOUNDATION_MOMENT_TYPES,type FoundationMomentType} from './general-foundation.ts';
import type {GeneralPlaybookRecord} from './general-playbook';
import {matchesRejected,rejectionSignature} from './rejected-examples.ts';
import {hasRelevantOfferExplanation,type OfferExplanationContext} from './relevant-offer.ts';

export const LEARNING_TAGS=['warm_acknowledgement','grounded_specificity','explain_relevant_offer','preserve_selected_items','keep_stage','fulfil_open_commitment','use_collected_information','capture_missing_email','preserve_review_sequence','optional_next_step','respect_incumbent','reduce_pressure','concise_reply','answer_actual_question','verify_specific_claims','explain_call_intent','reach_right_person','collect_contact_route','follow_agreed_review'] as const;
export type LearningTag=typeof LEARNING_TAGS[number];
export type LearningMomentType=FoundationMomentType|`custom_${string}`|'unclassified';
export type StructuredLearningLesson={version:1;momentType:LearningMomentType;tags:LearningTag[];requiredMoves:string[];forbiddenMoves:string[];pattern:string;negativePatterns:string[];explanation:string;reviewStatus:'active'|'needs_why'|'needs_override'|'needs_move_approval';compiledAt:number;approvedMoveId?:string};
export type LearningAuditEntry={id:string;companyId:string;companyName:string;callId:string;suggestionId:string;sourceLocations:string[];goldenMomentId?:string;buyerLine:string;previousContext:Pick<Turn,'id'|'role'|'text'|'at'>[];buyerWindow:Pick<Turn,'id'|'role'|'text'|'at'>[];stageId:string;legacyMoment:string;momentType:LearningMomentType;suggested:string;actual:string;learningExplanation:string;timestamp:number;feedbackAt?:number;missingWhy:boolean;missingOverride:boolean;missingContext:boolean;structuredLesson:StructuredLearningLesson};
export type LearningAudit={total:number;byMomentType:{momentType:LearningMomentType;count:number;needsWhy:number;ids:string[]}[];missingWhyCount:number;missingOverrideCount:number;unclassifiedCount:number;entries:LearningAuditEntry[]};
const normalized=(value:string)=>value.toLowerCase().replace(/[’‘]/g,"'").replace(/[^a-z0-9@.]+/g,' ').trim();
const text=(value:unknown,max=2000)=>typeof value==='string'?value.trim().slice(0,max):'';
const unique=<T>(values:T[])=>[...new Set(values)];
const taggedMoves:Record<LearningTag,[string,string]>={
 warm_acknowledgement:['React briefly and warmly before the substantive move.','Do not sound flat or start with a repeated stock acknowledgement.'],
 grounded_specificity:['Use the relevant details already supplied, and only current-company supported facts.','Do not replace a specific buyer situation with a generic response.'],
 explain_relevant_offer:['Briefly explain the relevant current-company supported offer before the document handoff.','Do not give only a document/email handoff when the reviewed lesson asks what we offer; historical claims are not evidence.'],
 preserve_selected_items:['Confirm every item the buyer actually selected; separate items still under research.','Do not omit a selected item or treat a researched item as selected.'],
 keep_stage:['Advance the detected moment and current stage.','Do not restart discovery after the buyer has moved to a concrete next step.'],
 fulfil_open_commitment:['Confirm the agreed commitment and collect only the information needed to fulfil it.','Do not open unrelated discovery while the current commitment is unfulfilled.'],
 use_collected_information:['Use the buyer information already captured in the current call.','Do not ask again for information already supplied or declined.'],
 capture_missing_email:['Capture a sending email only when the current agreed send needs one.','Do not skip the missing destination or re-ask an address already supplied.'],
 preserve_review_sequence:['Restate the actual review sequence, including any price discussion after review.','Do not omit an agreed review step or move prices before it.'],
 optional_next_step:['Present the next useful step as an invitation and leave room to think.','Do not turn tentative interest into a commitment to buy or qualify.'],
 respect_incumbent:['Preserve the buyer’s option to keep the incumbent during comparison.','Do not pressure a supplier switch or assume dissatisfaction.'],
 reduce_pressure:['Ask one easy, relevant question and let the buyer express their needs.','Do not force a choice or push beyond a stated boundary.'],
 concise_reply:['Use concise, natural wording while retaining the useful next move.','Do not pad the reply or remove a necessary next action merely to shorten it.'],
 answer_actual_question:['Address the buyer’s actual question or concern before moving on.','Do not substitute a generic question for the requested answer.'],
 verify_specific_claims:['Ground each supplier specification or commercial term in current Company Knowledge.','Do not reuse historical numbers, prices, availability or timing as current facts.'],
 explain_call_intent:['Give brief who-and-why context that earns the requested next step.','Do not demand a transfer with no company or call intent.'],
 reach_right_person:['Check purchasing responsibility before a cold-call product pitch.','Do not ask a gatekeeper for needs, specifications, prices or volumes.'],
 collect_contact_route:['If purchasing is unavailable, seek the name, best email and suitable callback time.','Do not pitch to the routing contact or invent contact details.'],
 follow_agreed_review:['Follow the actual agreed review and ask about its remaining decision.','Do not invent an earlier call, sent material or completed review.'],
};

/** Semantic moment names replace display labels, while the original label is
 * retained as audit evidence. Historical dialogue never establishes this call's
 * facts; it only classifies the lesson's conversational situation. */
export function canonicalLearningMoment(input:{moment?:string;buyerLine?:string;actual?:string;explanation?:string;state?:Partial<ConversationState>}):LearningMomentType {
 const label=normalized(input.moment||'').replace(/ /g,'_'),buyer=normalized(input.buyerLine||''),actual=normalized(input.actual||''),why=normalized(input.explanation||'');
 if(/^custom_[a-z0-9_]{1,60}$/.test(label))return label as LearningMomentType;
 if(FOUNDATION_MOMENT_TYPES.includes(label as FoundationMomentType))return label as FoundationMomentType;
 if(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(input.buyerLine||'')||label==='contact_handoff'||/email (?:given|received|provided)/.test(label.replace(/_/g,' ')))return 'email_close';
 if(/gatekeeper|routing|right_person|front_desk/.test(label)||/\b(?:not (?:the )?right person|receptionist|front desk|transfer you|not available|unavailable|not in (?:the )?office)\b/.test(buyer)||/\b(?:gatekeeper|right person|person in charge of purchasing)\b/.test(why)&&!/\b(?:i am|i'm|i handle|i manage|i do|yes.*in charge)\b/.test(buyer))return 'cold_call_gate';
 if(/\b(?:yes.*(?:in charge|handle purchasing)|i (?:am|m|handle|manage).*(?:purchas|in charge))\b/.test(buyer))return 'intro';
 const selected=/\b(?:interested in|focus on|we need|i need|we want|i want|prefer|chosen|picked|selected|only|just|would like)\b/.test(buyer)||/\b[a-z]{1,4}\d{2,6}\b.{0,20}\bfor\b|\bdefinitely\s+[a-z]{1,4}\d{2,6}\b/.test(buyer)||/\b(?:buyer (?:already )?(?:chose|picked|selected)|selected (?:item|product|grade)|all (?:the )?products|both products|grade they want|grades they want)\b/.test(why);
 const selectionMove=/\b(?:send|share|email)\b.{0,80}\b(?:profile|specs?|documents?|brochure|information)\b/.test(actual)&&/\bemail\b/.test(actual);
 if(label==='interest_narrowed'||selected&&(selectionMove||/\b(?:send|share|specs?|profile|documents?)\b/.test(actual)))return 'interest_narrowed';
 if(/agreed_next_step|next_step|document_confirmation|confirm_send|agreed_handoff/.test(label)||input.state?.nextAction&&['capture_email','confirm_send'].includes(input.state.nextAction.kind)||/\b(?:send (?:me|us)|email (?:me|us))\b/.test(buyer)&&/profile|specs|review|website|catalog/.test(buyer))return 'next_step_agreed';
 if(/trust|incumbent|qualified_comparison/.test(label)||/\b(?:supplier|vendor|incumbent)\b/.test(buyer)&&/\b(?:trust|risk|switch|reliable|happy|satisfied|comparison|currently|already|have)\b/.test(buyer))return 'trust_objection';
 if(/price_test|spec_question|price_spec|negotiation|cif/.test(label)||/\b(?:what|which|how|confirm|give|tell)\b.{0,100}\b(?:grades?|purity|content|moq|minimum order|lead time|certif\w*|price|prices|cif|fob|availability|stock)\b/.test(buyer))return 'price_spec_stall';
 if(/pending_research|polite_stall/.test(label)||/\b(?:need|requires?|further|more|market|internal)\b.{0,35}\bresearch\b|\b(?:think about it|not sure yet|look into it)\b/.test(buyer))return 'pending_research';
 if(/followup|follow_up|reactivation|dormant/.test(label))return 'follow_up';
 if(/opening|greeting|intro/.test(label))return 'intro';
 if(/general|needs|discovery|application|difficulty|priority|interest/.test(label)||/\b(?:we use|our application|we buy|our production|current process)\b/.test(buyer))return 'needs_discovery';
 return 'unclassified';
}

export function compileLearningLesson(input:{momentType:LearningMomentType;why:string;actual:string;suggested?:string;reason?:string},now=Date.now()):StructuredLearningLesson {
 const why=text(input.why),actual=text(input.actual,3000),bad=text(input.suggested,3000),line=normalized(why),tags:LearningTag[]=[];
 const add=(tag:LearningTag,condition:boolean)=>{if(condition)tags.push(tag);};
 add('warm_acknowledgement',/warm|react|reaction|human|monoton|flat|friendly|acknowledg|enthusias|agree first|agree-first/.test(line));
 add('grounded_specificity',/generic|specific|details?|information|explain|context|knowledge|concrete|what we offer|exactly what|flagship|advantages|general product/.test(line));
 add('explain_relevant_offer',['intro','interest_narrowed','trust_objection'].includes(input.momentType)&&/what we offer|what (?:we|our company) (?:supply|produce)|exact(?:ly)? (?:what )?products?|flagship|as much information|more (?:product )?(?:information|detail)|give.{0,20}(?:product )?information|(?:don t|not) just.{0,20}(?:send|email)|our advantages/.test(line));
 add('preserve_selected_items',/selected|chose|chosen|picked|both|all.*products|omit|left out|ignored.*(?:product|grade|item)|research.*(?:other|different)/.test(line));
 add('keep_stage',/stage|discovery|already.*(?:agreed|chosen|selected|picked)|regress|moved past|restart|next step/.test(line));
 add('fulfil_open_commitment',/commitment|agreed|promis|next step|send.*(?:profile|spec|document)|(?:profile|document).*send/.test(line));
 add('use_collected_information',/\b(?:already|given|received|provided|collected|repeat\w*|re ask|ignored|ignore|told)\b/.test(line));
 add('capture_missing_email',/email|e mail|address|destination/.test(line));
 add('preserve_review_sequence',/engineer|sequence|after.*review|review.*pric|pric.*review/.test(line));
 add('optional_next_step',/optional|room|think|express|invitation|if useful|if interested|let.*buyer|space/.test(line));
 add('respect_incumbent',/incumbent|supplier|switch|replac|backup|low risk/.test(line));
 add('reduce_pressure',/press|push|force|room|think|express|permission|choice|space/.test(line));
 add('concise_reply',/short|long|brief|concise|wordy|rambl|repetit|too much|work simple/.test(line));
 add('answer_actual_question',/answer|question|asked|concern|respond|response|reply/.test(line));
 add('verify_specific_claims',/fact|invent|specification|price|purity|timing|deadline|number|verify|verified|verification|advantages|competitive/.test(line));
 add('explain_call_intent',/intent|who.*why|introduc|reason.*call|what.*about/.test(line));
 add('reach_right_person',/gatekeeper|purchas|right person|decision maker|front desk|reception/.test(line));
 add('collect_contact_route',/unavailable|not available|best time|callback|call back|contact.*name|contact of.*person|his (?:number|email)/.test(line));
 add('follow_agreed_review',/follow up|followup|review.*progress|check.*review|review.*complete/.test(line));
 const defaults:Partial<Record<LearningMomentType,LearningTag[]>>={interest_narrowed:['preserve_selected_items','keep_stage','capture_missing_email'],next_step_agreed:['fulfil_open_commitment','keep_stage'],email_close:['use_collected_information','fulfil_open_commitment'],trust_objection:['respect_incumbent','optional_next_step'],cold_call_gate:['explain_call_intent','reach_right_person'],price_spec_stall:['answer_actual_question','verify_specific_claims'],pending_research:['optional_next_step','reduce_pressure'],follow_up:['follow_agreed_review']};
 const compiled=unique([...tags,...(defaults[input.momentType]||[])]),negativePatterns=['repeat_rejected_wording'];
 if(['interest_narrowed','next_step_agreed','email_close'].includes(input.momentType)&&/relevant|supply partner|what (?:are|do).*looking for|what.*needs/.test(normalized(bad)))negativePatterns.push('generic_discovery_after_selection');
 if(compiled.includes('fulfil_open_commitment'))negativePatterns.push('discovery_with_open_commitment');
 if(input.momentType==='email_close')negativePatterns.push('ask_email_already_given');
 if(compiled.includes('preserve_selected_items'))negativePatterns.push('erase_selected_item');
 if(compiled.includes('respect_incumbent'))negativePatterns.push('pressure_supplier_switch');
 if(compiled.includes('verify_specific_claims'))negativePatterns.push('unsupported_fact_or_timing');
 if(compiled.includes('reach_right_person'))negativePatterns.push('pitch_to_gatekeeper','bare_transfer');
 if(compiled.includes('explain_relevant_offer'))negativePatterns.push('docs_only_instead_of_relevant_offer');
 const core=coreFoundationMoveFor(input.momentType);
 return {version:1,momentType:input.momentType,tags:compiled,requiredMoves:compiled.map(tag=>taggedMoves[tag][0]),forbiddenMoves:compiled.map(tag=>taggedMoves[tag][1]),pattern:core?.template||'{acknowledgement} {approved_next_move}',negativePatterns:unique(negativePatterns),explanation:why,reviewStatus:!why?'needs_why':!actual?'needs_override':!core?'needs_move_approval':'active',compiledAt:now};
}

type PendingEntry=Omit<LearningAuditEntry,'momentType'|'missingWhy'|'missingOverride'|'missingContext'|'structuredLesson'>;
/** Read-only audit: no browser, storage, API or document access. Missing source
 * context is recorded instead of assigning an old edit to today's buyer turn. */
export function auditEditedMoments(companies:Manufacturer[],calls:CallRecord[],now=Date.now()):LearningAudit {
 const result=new Map<string,PendingEntry>();
 const canonicalCall=(companyId:string,suggestionId:string,callId:string)=>{const found=calls.filter(call=>call.manufacturerId===companyId&&call.suggestions?.some(row=>row.id===suggestionId));return found.find(call=>call.id===callId||call.suggestions?.some(row=>row.id===suggestionId&&row.learningCapture?.callId===callId))?.id||(found.length===1?found[0].id:callId);};
 const put=(entry:PendingEntry)=>{const old=result.get(entry.id);if(!old){result.set(entry.id,entry);return;}const latest=(entry.feedbackAt||entry.timestamp)>=(old.feedbackAt||old.timestamp);result.set(entry.id,{...old,...latest?entry:{},sourceLocations:unique([...old.sourceLocations,...entry.sourceLocations]),learningExplanation:entry.learningExplanation||old.learningExplanation,actual:latest?(entry.actual||old.actual):(old.actual||entry.actual),suggested:old.suggested||entry.suggested,buyerLine:old.buyerLine||entry.buyerLine,buyerWindow:old.buyerWindow.length?old.buyerWindow:entry.buyerWindow,previousContext:old.previousContext.length?old.previousContext:entry.previousContext,goldenMomentId:entry.goldenMomentId||old.goldenMomentId});};
 for(const company of companies){
  const brain=ensureCompanyBrain(company),owned=calls.filter(call=>call.manufacturerId===company.id);
  for(const call of owned)for(const row of call.suggestions||[]){
   if(row.status!=='edited')continue;
   const pair=brain.learning.find(pair=>pair.companyId===company.id&&pair.suggestionId===row.id&&(canonicalCall(company.id,row.id,pair.callId)===call.id));
   const index=call.turns.findIndex(turn=>turn.id===row.triggerTurnId&&turn.role==='buyer');
   const window=index>=0?call.turns.slice(0,index+1):row.learningCapture?.buyerWindow||pair?.buyerWindow||[];
   const buyer=[...window].reverse().find(turn=>turn.role==='buyer');
   const callId=call.id,id=`${company.id}:${callId}:${row.id}`,extra=row as unknown as Record<string,unknown>;
   put({id,companyId:company.id,companyName:company.name,callId,suggestionId:row.id,sourceLocations:['call_history'],buyerLine:buyer?.text||row.buyerQuote||'',buyerWindow:window,previousContext:buyer?window.slice(0,window.indexOf(buyer)):[],stageId:pair?.stageId||row.learningCapture?.stageId||row.guidance.stageId||call.callContext?.stageId||'cold_call',legacyMoment:pair?.moment||row.learningCapture?.moment||row.guidance.moment||'general',suggested:row.originalSay||pair?.suggested||'',actual:pair?.actual||(row.originalSay?row.guidance.say:row.actualSpoken)||'',learningExplanation:text(extra.learningExplanation||extra.whyExplanation),timestamp:row.at,feedbackAt:row.feedbackAt||row.editedAt});
  }
  for(const pair of brain.learning){
   if(pair.companyId!==company.id||pair.verdict!=='Edited')continue;
   const callId=canonicalCall(company.id,pair.suggestionId,pair.callId),buyer=[...pair.buyerWindow].reverse().find(turn=>turn.role==='buyer'),extra=pair as unknown as Record<string,unknown>;
   put({id:`${company.id}:${callId}:${pair.suggestionId}`,companyId:company.id,companyName:company.name,callId,suggestionId:pair.suggestionId,sourceLocations:['company_learning_store'],buyerLine:buyer?.text||'',buyerWindow:pair.buyerWindow,previousContext:buyer?pair.buyerWindow.slice(0,pair.buyerWindow.indexOf(buyer)):[],stageId:pair.stageId,legacyMoment:pair.moment,suggested:pair.suggested,actual:pair.actual,learningExplanation:text(extra.learningExplanation),timestamp:pair.at,feedbackAt:pair.feedbackAt});
  }
  for(const golden of brain.goldenMoments||[]){
   if(golden.companyId!==company.id||!golden.repOverride?.trim())continue;
   const callId=canonicalCall(company.id,golden.suggestionId,golden.callId);
   const buyer={id:`golden-buyer:${golden.suggestionId}`,role:'buyer' as const,text:golden.buyerLine,at:golden.timestamp};
   put({id:`${company.id}:${callId}:${golden.suggestionId}`,companyId:company.id,companyName:company.name,callId,suggestionId:golden.suggestionId,sourceLocations:['golden_moment'],goldenMomentId:golden.id,buyerLine:golden.buyerLine,buyerWindow:[...golden.previousContext,buyer],previousContext:golden.previousContext,stageId:golden.learningStageId||golden.stageId,legacyMoment:golden.learningMoment||golden.momentType,suggested:golden.copilotSuggestion,actual:golden.repOverride,learningExplanation:text(golden.learningExplanation),timestamp:golden.timestamp,feedbackAt:golden.feedbackAt});
  }
 }
 const entries=[...result.values()].map(entry=>{const prior=companies.find(company=>company.id===entry.companyId)?.brain?.learning.find(pair=>pair.companyId===entry.companyId&&pair.suggestionId===entry.suggestionId&&(pair.importAuditId===entry.id||canonicalCall(entry.companyId,pair.suggestionId,pair.callId)===entry.callId))?.structuredLesson,approved=prior?.approvedMoveId&&/^custom_[a-z0-9_]{1,60}$/.test(prior.momentType)?prior:undefined;
  const momentType=approved?.momentType||canonicalLearningMoment({moment:entry.legacyMoment,buyerLine:entry.buyerLine,actual:entry.actual,explanation:entry.learningExplanation}),compiled=compileLearningLesson({momentType,why:entry.learningExplanation,actual:entry.actual,suggested:entry.suggested},now),structuredLesson=approved?{...compiled,approvedMoveId:approved.approvedMoveId,pattern:approved.pattern,reviewStatus:!entry.learningExplanation?'needs_why' as const:!entry.actual?'needs_override' as const:'active' as const}:compiled;return {...entry,momentType,missingWhy:!entry.learningExplanation.trim(),missingOverride:!entry.actual.trim(),missingContext:!entry.buyerLine.trim(),structuredLesson};}).sort((a,b)=>b.timestamp-a.timestamp||a.id.localeCompare(b.id));
 const types=unique(entries.map(entry=>entry.momentType)).sort();
 return {total:entries.length,entries,byMomentType:types.map(momentType=>{const group=entries.filter(entry=>entry.momentType===momentType);return {momentType,count:group.length,needsWhy:group.filter(entry=>entry.missingWhy).length,ids:group.map(entry=>entry.id)};}),missingWhyCount:entries.filter(entry=>entry.missingWhy).length,missingOverrideCount:entries.filter(entry=>entry.missingOverride).length,unclassifiedCount:entries.filter(entry=>entry.momentType==='unclassified').length};
}

/** Idempotent import keeps every edited moment, including a pending Why or
 * missing old transcript. It never edits the call history it was given. */
export function importEditedMoments(companies:Manufacturer[],calls:CallRecord[],now=Date.now()):{companies:Manufacturer[];audit:LearningAudit;importedCount:number;updatedCount:number} {
 const audit=auditEditedMoments(companies,calls,now);let importedCount=0,updatedCount=0;
 const updated=companies.map(company=>{let brain=ensureCompanyBrain(company),changed=false;const learning=[...brain.learning];
  for(const entry of audit.entries.filter(entry=>entry.companyId===company.id)){
   const index=learning.findIndex(pair=>pair.companyId===company.id&&pair.suggestionId===entry.suggestionId&&(pair.callId===entry.callId||calls.some(call=>call.id===entry.callId&&call.suggestions?.some(row=>row.id===entry.suggestionId&&row.learningCapture?.callId===pair.callId))||audit.entries.filter(item=>item.companyId===company.id&&item.suggestionId===entry.suggestionId).length===1));
   const prior=learning[index],call=calls.find(item=>item.id===entry.callId&&item.manufacturerId===company.id),callContext=normalizeCallContext(prior?.callContext||call?.callContext||defaultCallContext()),state=prior?.state||deriveConversationState({callId:entry.callId,turns:entry.buyerWindow,callContext,stageMap:brain.playbook.stages});
   const oldCompiled=prior?.structuredLesson;
   const structuredLesson=oldCompiled&&JSON.stringify({...oldCompiled,compiledAt:0})===JSON.stringify({...entry.structuredLesson,compiledAt:0})?oldCompiled:entry.structuredLesson;
   const pair:LearningPair={...prior,id:prior?.id||entry.id,suggestionId:entry.suggestionId,companyId:company.id,callId:entry.callId,buyer:prior?.buyer||call?.buyer||'',buyerWindow:entry.buyerWindow,stageId:entry.stageId,moment:entry.legacyMoment,callContext,state,prompt:prior?.prompt||'Imported saved edit: original generation prompt unavailable; historical saved context retained.',requestContext:prior?.requestContext||{historicalImport:true,callContext,turns:entry.buyerWindow,manufacturer:{id:company.id,name:company.name,products:company.products}},suggested:entry.suggested,actual:entry.actual,verdict:'Edited',actualSource:prior?.actualSource||'edited',outcome:prior?.outcome||call?.outcome||'',at:entry.timestamp,feedbackAt:entry.feedbackAt||prior?.feedbackAt,promoted:prior?.promoted||false,verified:prior?.verified||false,evidence:prior?.evidence||[],learningExplanation:entry.learningExplanation,structuredLesson,importAuditId:entry.id,importSourceLocations:unique([...entry.sourceLocations,'company_learning_store']).sort(),...entry.goldenMomentId?{goldenMomentId:entry.goldenMomentId}:{}};
   if(!prior){learning.push(pair);importedCount++;changed=true;}else if(JSON.stringify(pair)!==JSON.stringify(prior)){learning[index]=pair;updatedCount++;changed=true;}
  }
  if(changed)brain={...brain,learning,updatedAt:now};return {...company,brain};
 });
 return {companies:updated,audit,importedCount,updatedCount};
}

export function completeLearningWhy(company:Manufacturer,entryId:string,why:string,now=Date.now()):Manufacturer {
 const explanation=text(why);if(!explanation)throw new Error('Write what the copilot should learn; Why cannot be empty.');
 const brain=ensureCompanyBrain(company),pair=brain.learning.find(item=>item.id===entryId||item.importAuditId===entryId);if(!pair)throw new Error('This company’s imported moment was not found.');
 const buyer=[...pair.buyerWindow].reverse().find(turn=>turn.role==='buyer'),momentType=canonicalLearningMoment({moment:pair.structuredLesson?.momentType||pair.moment,buyerLine:buyer?.text,actual:pair.actual,explanation});
 const compiled=compileLearningLesson({momentType,why:explanation,actual:pair.actual,suggested:pair.suggested},now),structuredLesson=pair.structuredLesson?.approvedMoveId?{...compiled,approvedMoveId:pair.structuredLesson.approvedMoveId,pattern:pair.structuredLesson.pattern,reviewStatus:pair.actual?'active' as const:'needs_override' as const}:compiled;
 return {...company,brain:{...brain,updatedAt:now,learning:brain.learning.map(item=>item.id===pair.id?{...item,learningExplanation:explanation,structuredLesson,feedbackAt:now}:item),goldenMoments:brain.goldenMoments?.map(item=>item.id===pair.goldenMomentId||item.suggestionId===pair.suggestionId&&item.callId===pair.callId?{...item,learningExplanation:explanation,feedbackAt:now}:item)}};
}

/** A new situation stays pending until the user approves its shared move.
 * The company keeps the actual lines and Why; the foundation supplies only
 * the approved general template. No historical product claim is promoted. */
export function approveLearningMove(company:Manufacturer,entryId:string,playbook:GeneralPlaybookRecord,moveId:string,now=Date.now()):Manufacturer {
 const move=normalizeGeneralFoundation(playbook.foundation).moves.find(item=>item.id===moveId&&item.origin==='approved');
 if(!move||!/^custom_[a-z0-9_]{1,60}$/.test(move.momentType))throw new Error('Approve the new General Playbook move before linking this company moment.');
 const brain=ensureCompanyBrain(company),pair=brain.learning.find(item=>item.id===entryId||item.importAuditId===entryId);if(!pair)throw new Error('This company’s imported moment was not found.');
 const compiled=compileLearningLesson({momentType:move.momentType as LearningMomentType,why:pair.learningExplanation||'',actual:pair.actual,suggested:pair.suggested},now);
 const structuredLesson:StructuredLearningLesson={...compiled,approvedMoveId:move.id,pattern:move.template,reviewStatus:!compiled.explanation?'needs_why':!pair.actual?'needs_override':'active'};
 return {...company,brain:{...brain,updatedAt:now,learning:brain.learning.map(item=>item.id===pair.id?{...item,structuredLesson,feedbackAt:now}:item)}};
}

export function learningStageCompatible(source:string,current:string,moment:LearningMomentType):boolean {
 if(source===current)return true;
 const commercial=(stage:string)=>/negotiat|price_negotiation|commercial_terms/.test(stage);
 if(commercial(source)!==commercial(current))return false;
 return ['interest_narrowed','next_step_agreed','email_close','trust_objection','pending_research','cold_call_gate','intro','needs_discovery','follow_up'].includes(moment);
}

/** Explicit structured matching prevents human display labels such as “Email
 * received” or canonical `general` from deleting a useful reviewed lesson. */
export function learningExampleMatchesSituation(example:RetrievedExample,stageId:string,legacyMoment:string,momentType?:LearningMomentType):boolean {
 const lesson=example.structuredLesson;
 if(lesson?.reviewStatus==='active')return !!momentType&&lesson.momentType===momentType&&learningStageCompatible(example.stageId,stageId,momentType);
 if(lesson&&momentType)return false; // Retained in the review queue, not silently activated.
 if(momentType){const historicalBuyer=example.context.split('\n').filter(line=>line.startsWith('buyer:')).at(-1)?.slice(6)||'';return canonicalLearningMoment({moment:example.moment,buyerLine:historicalBuyer,actual:example.actual||example.positive})===momentType&&learningStageCompatible(example.stageId,stageId,momentType);}
 return example.stageId===stageId&&example.moment===legacyMoment;
}

/** Shared values are generated codes + core placeholders only. No original
 * company, buyer, product, price, line, or free-text Why leaves its Brain. */
export function generalLearningPattern(pair:Pick<LearningPair,'id'|'structuredLesson'|'feedbackAt'|'at'>) {
 const lesson=pair.structuredLesson;if(!lesson||lesson.reviewStatus!=='active'||lesson.momentType==='unclassified')return null;
 return {id:pair.id,momentType:lesson.momentType,template:lesson.pattern,tags:lesson.tags,requiredMoves:lesson.requiredMoves,forbiddenMoves:lesson.forbiddenMoves,negativePatterns:lesson.negativePatterns,approvedAt:pair.feedbackAt||pair.at};
}

export function learnedSuggestionProblems(say:string,examples:RetrievedExample[]=[],context?:OfferExplanationContext):string[] {
 const problems:string[]=[],line=normalized(say);
 for(const example of examples){
  if(example.negative&&matchesRejected(say,[rejectionSignature(example.negative)],[example]))problems.push(`Repeats rejected line from ${example.id}`);
  const lesson=example.structuredLesson;if(!lesson||lesson.reviewStatus!=='active')continue;
  const patterns=lesson.negativePatterns;
  if(lesson.tags.includes('warm_acknowledgement')&&!/\b(?:great|thanks?|thank you|of course|sure|okay|ok|good|sounds|perfect|absolutely|happy|glad|understood|got it|that helps|helpful|interesting|makes sense)\b/.test(line))problems.push(`Omits the brief warm reaction learned in ${example.id}`);
  if(lesson.tags.includes('explain_relevant_offer')&&!hasRelevantOfferExplanation(say,context))problems.push(`Gives only a handoff instead of the relevant supported offer learned in ${example.id}`);
  if(lesson.momentType==='email_close'&&lesson.tags.includes('grounded_specificity')&&!/\b(?:profile|specs?|specifications?|documents?|catalog|brochure|website|information|report|quote|data)\b/.test(line))problems.push(`Omits the agreed materials instead of the specific close learned in ${example.id}`);
  if(patterns.includes('generic_discovery_after_selection')&&/\b(?:is this relevant|relevant to what|what are you looking for in (?:a )?supply partner|what do you look for in (?:a )?supplier)\b/.test(line))problems.push(`Repeats rejected generic discovery move from ${example.id}`);
  if(patterns.includes('discovery_with_open_commitment')&&/\b(?:what are you looking for|what do you look for|what (?:are|is) your (?:needs|criteria)|tell me about your needs)\b/.test(line))problems.push(`Opens discovery instead of the reviewed commitment move from ${example.id}`);
  if(patterns.includes('ask_email_already_given')&&say.includes('?')&&/\b(?:what|which|best|good|provide|share|give)\b.{0,35}\b(?:email|e mail|address)\b/.test(line))problems.push(`Re-asks a supplied email instead of the reviewed close from ${example.id}`);
  if(patterns.includes('pressure_supplier_switch')&&/\b(?:you (?:need|have|must|should) to|you should|let s|let us)\b.{0,35}\b(?:switch|replace|change suppliers)\b/.test(line))problems.push(`Pressures a supplier switch rejected in ${example.id}`);
  if(patterns.includes('pitch_to_gatekeeper')&&/\b(?:purity|moq|minimum order|how much|what volume|how many|\d+(?:\.\d+)?\s*%|cif|fob)\b/.test(line))problems.push(`Repeats a rejected gatekeeper pitch from ${example.id}`);
 }
 return unique(problems);
}
