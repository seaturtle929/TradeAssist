import {callRouteAtRequest} from './call-route.ts';
import {applyClientCoachingContext,clientContextInstructions,type ClientCoachingContext} from './client-coaching-context.ts';
import type {CallConfigurationBinding,ConfigurationBoundary,ConfigurationStage} from './company-configuration';
import {configurationReferences,configurationStageMap} from './company-configuration.ts';

/** An immutable call binding is the authority for this call. Drafts and the
 * current editable Brain are deliberately not consulted by the runtime. */
export type ConfigurationContext={clientContext?:ClientCoachingContext;clientId?:string;contactId?:string;callId?:string;companyConfiguration?:CallConfigurationBinding;manufacturer?:{id?:string;name?:string;products?:string};turns?:{role:string;text:string}[];callContext?:unknown;sources?:{id:string;title?:string;text:string;complete?:boolean}[];brain?:unknown;conversationState?:unknown};
export function selectedConfigurationStage(context:ConfigurationContext):ConfigurationStage|undefined {
 const binding=context.companyConfiguration;
 if(!binding)return;
 if(binding.companyId!==context.manufacturer?.id||binding.snapshot.companyId!==binding.companyId||binding.versionId!==binding.snapshot.id||binding.version!==binding.snapshot.version)throw Error('The call configuration does not belong to this company/version.');
 const stage=binding.snapshot.stages.find(item=>item.id===binding.selectedStageId);
 if(!stage)throw Error('The selected stage is not part of this call configuration.');
 return stage;
}
export function activeConfigurationBoundaries(context:ConfigurationContext):ConfigurationBoundary[]{
 const stage=selectedConfigurationStage(context);if(!stage)return [];
 const explicit=context.companyConfiguration!.snapshot.boundaries.filter(item=>item.status==='active'&&(item.scope==='company'||item.stageId===stage.id));
 // A clearly mandatory stage instruction remains mandatory when a manager
 // writes it in How we sell. Preferences are never promoted to authority and a
 // playbook can restrict, but cannot grant, commercial authorization.
 const stageLimits=stage.playbook.split(/\n+|(?<=[.!?])\s+/).filter(text=>/\b(?:do not|don't|never|must not|requires? (?:prior )?(?:manager )?approval)\b/i.test(text)).map((text,index):ConfigurationBoundary=>({id:`stage-instruction:${stage.id}:${index}`,text,authority:/\b(?:do not|don't|never|must not)\b/i.test(text)?'prohibited':'approval_required',scope:'stage',stageId:stage.id,status:'active',origin:'manager'}));
 return [...explicit,...stageLimits];
}
export function applyCoachingConfiguration<T extends ConfigurationContext>(context:T):T {
 context=applyClientCoachingContext(context);
 const stage=selectedConfigurationStage(context);if(!stage)return context;
 const binding=context.companyConfiguration!,snapshot=binding.snapshot;
 const allSources=configurationReferences(snapshot);
 const query=[...(context.turns||[]).slice(-4).map(turn=>turn.text),...(context.clientContext?.entries||[]).filter(entry=>entry.kind==='fact'&&!entry.needsReview).slice(0,8).map(entry=>entry.text)].join(' ').toLowerCase();
 const terms=[...new Set(query.match(/[a-z0-9]{3,}/g)||[])];
 // A call keeps the complete immutable knowledge in its binding; its request
 // projection stays within existing source/fact limits. Rank whole approved
 // entries instead of truncating away a unit, condition or effective date.
 let remaining=155000;
 const sources=allSources.map((source,index)=>({source,index,score:terms.filter(term=>source.text.toLowerCase().includes(term)).length})).sort((one,two)=>two.score-one.score||one.index-two.index).flatMap(({source})=>{if(source.text.length>remaining)return [];remaining-=source.text.length;return [source];}).slice(0,40);
 const oldContext=(context.callContext&&typeof context.callContext==='object'?context.callContext:{}) as Record<string,unknown>;
 const oldBrain=(context.brain&&typeof context.brain==='object'?context.brain:{}) as Record<string,unknown>;
 const boundaries=activeConfigurationBoundaries(context);
 const facts=snapshot.knowledge.filter(item=>item.status==='active'&&item.origin!=='legacy').map(item=>{const source=sources.find(source=>source.knowledgeId===item.id);return source?{id:item.id.slice(0,200),kind:item.kind==='identity'?'identity' as const:'product' as const,text:item.text.slice(0,1500),sourceId:source.id,quote:source.text.slice(0,2000),confirmed:true}:null;}).filter(item=>item!==null);
 const preferences=snapshot.preferences.filter(item=>item.scope==='company'||item.stageId===stage.id).map(item=>item.text).join('\n');
 const learningExamples=Array.isArray(oldBrain.learningExamples)?oldBrain.learningExamples.filter(example=>{const item=example as {positive?:string;actual?:string};return !configurationSuggestionProblems(item.actual||item.positive||'',context).length;}):[];
 const brain={...oldBrain,companyId:binding.companyId,facts,defaultOpening:typeof oldBrain.defaultOpening==='string'?oldBrain.defaultOpening.slice(0,1200):undefined,moves:{[stage.id]:stage.playbook.slice(0,2000)},rules:{neverInvent:'Never invent company facts. Only this call configuration’s active knowledge can establish them.',neverPromise:boundaries.filter(item=>item.authority==='prohibited').map(item=>item.text).join('\n').slice(0,5000),promiseThreshold:boundaries.filter(item=>item.authority==='allowed').map(item=>item.text).join('\n').slice(0,5000),escalateThreshold:boundaries.filter(item=>item.authority==='approval_required').map(item=>item.text).join('\n').slice(0,5000),phrasesToAvoid:'',tone:preferences.slice(0,2000)},learningExamples,decisionLog:Array.isArray(oldBrain.decisionLog)?oldBrain.decisionLog:[]};
 const oldState=context.conversationState&&typeof context.conversationState==='object'?context.conversationState:null;
 const allStages=configurationStageMap(snapshot,{includeRetired:true});
 const stageMap=[...allStages.filter(item=>item.id===stage.id),...allStages.filter(item=>item.id!==stage.id)].slice(0,15).map(item=>({...item,name:item.name.slice(0,120),purpose:item.purpose.slice(0,1000),extract:item.extract.slice(0,12).map(text=>text.slice(0,240)),give:item.give.slice(0,12).map(text=>text.slice(0,240)),hold:item.hold.slice(0,12).map(text=>text.slice(0,240)),exitCriteria:item.exitCriteria.slice(0,1000)}));
 return {...context,sources,manufacturer:{...context.manufacturer,products:snapshot.knowledge.filter(item=>item.status==='active'&&item.origin!=='legacy'&&item.kind==='product').map(item=>item.text).join('; ').slice(0,2000)},brain,callContext:{relationship:'first_contact',background:'',knownFacts:'',doNotGuess:'',...oldContext,stageId:stage.id,goal:stage.objective.slice(0,1000)},stageMap,currentStage:stage.id,goal:stage.objective.slice(0,1000),...oldState?{conversationState:{...oldState,stageId:stage.id,stageName:stage.name,stagePurpose:stage.objective}}:{}} as T;
}
export function configurationInstructions(context:ConfigurationContext):string {
 const stage=selectedConfigurationStage(context);if(!stage)return clientContextInstructions(context);
 const binding=context.companyConfiguration!,snapshot=binding.snapshot;
 return '\nACTIVE MANAGER CONFIGURATION — mandatory company authority, overriding older scripts/examples and generic stage defaults. This call is pinned to version '+binding.version+' ('+binding.versionId+'), selected stage '+stage.id+'. Keep this stage ID; adapt the immediate response to questions, objections and refusals without silently changing stage. Do not replace this stage with a cold-call pitch or generic purchasing-person check. Reaching the intended person through a company main line is a routing prerequisite in every stage: briefly identify yourself and politely request the known contact until current speech confirms who is present, then resume this selected objective. Shared buyer-centered sales judgment applies in every stage. The manager tailors objectives, facts, evidence and boundaries; stage questions and information to bring back are conditional discovery/review aids, never a compulsory questionnaire or permission to invent missing buyer facts. A reasonable buyer-chosen next step can advance the objective before the checklist is complete: respect it, explain its useful outcome and remember follow-through instead of reopening discovery. Existing generic stage wording must not force another question after that choice. Follow the FULL meaning of the manager objective, playbook, preferences and boundaries, including negation, conditions and exceptions; tags are not their replacement. Raw uploads, old knowledge, historical examples and actual rep claims cannot grant company authority. Only active configuration knowledge supports factual assertions; a fact does not authorize a commercial promise. Company-wide mandatory limits outrank stage instructions and learned examples. Ask for approval when required; do not assume approval from a buyer request. COMMERCIAL AUTHORITY: A knowledge entry containing an approved discount, available sample or documented terms is a reference option, not the representative’s present permission to offer it. Use the CURRENT active boundaries to decide authority. If approval is required or no applicable permission exists, NEVER say the concession is already approved, authorized, available to the buyer, or ready to proceed; plainly state that specific approval is needed. When the exact documented offer IS explicitly permitted now, confirm it naturally without inventing a deadline or needlessly seeking approval again.\n'+JSON.stringify({configuration:{companyId:binding.companyId,versionId:binding.versionId,version:binding.version,selectedStage:{id:stage.id,name:stage.name,objective:stage.objective,playbook:stage.playbook,informationToBringBack:stage.informationToBringBack},boundaries:activeConfigurationBoundaries(context),commercialAuthority:{discount:configurationAuthorizesAction(context,'discount'),priceMatch:configurationAuthorizesAction(context,'price_match'),sample:configurationAuthorizesAction(context,'sample'),paymentTerms:configurationAuthorizesAction(context,'payment_terms')},preferences:snapshot.preferences.filter(item=>item.scope==='company'||item.stageId===stage.id),openingPreference:context.brain&&typeof context.brain==='object'&&'defaultOpening' in context.brain?{wording:context.brain.defaultOpening,scope:'Representative wording preference for this request only; use when an opening fits. Never treat it as factual evidence, commercial authority, or actual spoken progress.'}:undefined,knowledgeAuthority:'Only active manager/document entries in supplied sources. Manager-provided entries are recorded as such; their exact text is evidence, not a fabricated document quotation.'}})+clientContextInstructions(context);
}
const clauseParts=(line:string)=>line.replace(/[’‘]/g,"'").split(/(?<=[.!?])\s+|;|\bbut\b/i);
const denied=(line:string)=>!/\b(?:but|however|and|yet)\s+(?:we|I)(?:'ll| will| can| could| would)?\s+(?:offer|provide|send|give|match|extend|ship|deliver)\b/i.test(line)&&(/\b(?:cannot|can't|won't|will not|do not|don't|not (?:approved|authorized|permitted)|subject to approval)\b/i.test(line)||/\b(?:need|needs|require|requires)\b.{0,35}\bapproval\b/i.test(line));
function actionOf(boundary:ConfigurationBoundary):string {
 if(boundary.action&&boundary.action!=='other')return boundary.action;
 const text=boundary.text.toLowerCase();
 if(/sample/.test(text))return 'sample';if(/discount/.test(text))return 'discount';if(/match.*price|price.*match/.test(text))return 'price_match';if(/payment|credit|net \d/.test(text))return 'payment_terms';if(/delivery|ship|deadline/.test(text))return 'delivery_promise';return boundary.action||'other';
}
function actionsOf(boundary:ConfigurationBoundary):string[]{
 const action=actionOf(boundary);if(action!=='commercial_promise')return [action];
 const text=boundary.text.toLowerCase(),actions:string[]=[];
 if(/sample/.test(text))actions.push('sample');if(/discount|concession|lower.{0,20}price/.test(text))actions.push('discount');if(/match.{0,20}price|price.{0,20}match/.test(text))actions.push('price_match');if(/payment|credit|terms/.test(text))actions.push('payment_terms');if(/delivery|ship|deadline/.test(text))actions.push('delivery_promise');
 return actions.length?actions:['commercial_promise'];
}
function actionOffered(clause:string,action:string):boolean {
 if(denied(clause))return false;
 const offer=/\b(?:we|I)(?:'ll| will| can| could| would| shall|'d| are able to)?\s+(?:offer|provide|send|arrange|give|approve|reduce|waive|match|extend|guarantee|ship|deliver|make)|\b(?:let(?:'s| us)|how about|if we|would (?:another |a )?sample|would (?:a |an )?discount|you can have)\b/i.test(clause);
 if(action==='sample')return /\bsamples?\b/i.test(clause)&&offer;
 if(action==='discount')return /\b(?:discount|reduce (?:our |the |your )?price|lower (?:our |the )?price|\d+\s*%\s*(?:off|reduction))\b/i.test(clause)&&offer;
 if(action==='price_match')return /\bmatch(?:ing)?\b.{0,35}\bprice|\bprice match/i.test(clause)&&offer;
 if(action==='payment_terms')return /\b(?:payment|credit|net \d+|\d+[- ]day terms)\b/i.test(clause)&&offer;
 if(action==='delivery_promise')return /\b(?:we|I)(?:'ll| will| can| could| would| shall|'d)\s+(?:ship|deliver|guarantee|ensure)\b|\b(?:promise|guarantee|commit to)\b.{0,45}\b(?:delivery|shipping|deadline)\b|\b(?:we|I)(?:'ll| will| can| could| would)\s+offer\b.{0,45}\b(?:delivery|shipping)\b/i.test(clause);
 if(action==='commercial_promise')return /\b(?:discount|free sample|match.{0,20}price|payment terms|guarantee|delivery date)\b/i.test(clause)&&offer;
 return false;
}
function failedSampleConditionSatisfied(boundary:ConfigurationBoundary,context:ConfigurationContext):boolean {
 const condition=boundary.text+' '+(boundary.condition||'');
 if(!/sample/i.test(condition)||!/until|before|after|once/i.test(condition)||!/why|reason|understand/i.test(condition)||!/fail|first|previous/i.test(condition))return false;
 return (context.turns||[]).some(turn=>turn.role==='buyer'&&/\b(?:failed|didn't work|did not work|failure)\b.{0,65}\b(?:because|due to|caused by|owing to)\b.{3,}|\b(?:because|due to)\b.{4,65}\b(?:failed|failure)\b/i.test(turn.text));
}
export function configurationAuthorizesAction(context:ConfigurationContext,action:string):boolean {
 const boundaries=activeConfigurationBoundaries(context);
 const permissions=boundaries.filter(permission=>permission.authority==='allowed'&&actionsOf(permission).includes(action)&&(!permission.condition&&!/\b(?:only (?:if|when|after)|subject to|provided|after|once|requires? approval)\b/i.test(permission.text)||failedSampleConditionSatisfied(permission,context)));
 return permissions.some(permission=>!boundaries.some(limit=>{
  if(limit.authority==='allowed'||!actionsOf(limit).includes(action))return false;
  if(limit.authority==='prohibited'&&failedSampleConditionSatisfied(limit,context))return false;
  const conditional=/\bunapproved\b|\bunless\b.{0,40}\b(?:approved|authorized)\b|\bwithout\b.{0,40}\bapproval\b|\bonly\b.{0,40}\b(?:approved|authorized)\b/i.test(limit.text);
  // A stage allowance never grants an exception to a company-wide limit. An
  // explicit company permission can satisfy a qualified "unapproved" rule,
  // while absolute prohibitions/approval requirements remain mandatory.
  if(conditional&&permission.scope==='company')return false;
  return true;
 }));
}
export function authorizedCurrentOfferStatement(clause:string,context:ConfigurationContext):boolean {
 return !!context.companyConfiguration&&/\bright now\b/i.test(clause)&&/\b(?:we|I)\s+(?:can|are authorized to|have authority to)\s+(?:confirm|offer|apply|give)\b/i.test(clause)&&/\bdiscount\b/i.test(clause)&&!/\b(?:get back|reply|respond|email|send|ship|deliver|factory|team|check|will)\b|\bI['’]ll\b/i.test(clause)&&configurationAuthorizesAction(context,'discount')&&!configurationSuggestionProblems(clause,context).length;
}
function discountPermissionScopeProblems(clause:string,context:ConfigurationContext):string[]{
 if(denied(clause)||!/\b(?:discount|concession|percent|%)\b|\d\s*%/i.test(clause)||!actionOffered(clause,'discount')&&!/\b(?:approved|authorized|authorised|permitted)\b/i.test(clause))return [];
 if(!configurationAuthorizesAction(context,'discount'))return [];
 const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
 const percentages=(value:string)=>[...value.replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi,word=>String(words[word.toLowerCase()])).matchAll(/\b(\d+(?:\.\d+)?)\s*(?:%|percent\b)/gi)].map(match=>Number(match[1]));
 const identifiers=(value:string)=>[...new Set(value.match(/\b[A-Z]{1,6}\d{1,6}\b/g)||[])].filter(id=>!context.manufacturer?.name?.includes(id));
 const proposed=percentages(clause),buyer=(context.turns||[]).findLast(turn=>turn.role==='buyer')?.text||'',named=identifiers(clause),items=named.length?named:identifiers(buyer);
 const permissions=activeConfigurationBoundaries(context).filter(permission=>permission.authority==='allowed'&&actionsOf(permission).includes('discount')&&(!permission.condition&&!/\b(?:only (?:if|when|after)|subject to|provided|after|once|requires? approval)\b/i.test(permission.text)||failedSampleConditionSatisfied(permission,context)));
 const fits=permissions.some(permission=>{
  const positive=clauseParts(permission.text).filter(part=>!denied(part)&&(!/\b(?:not|never|no)\b.{0,25}\d+\s*%/i.test(part)||/\bnot more than\b/i.test(part))).join(' '),limits=percentages(positive),scope=identifiers(positive);
  const amountFits=!limits.length||!proposed.length||proposed.every(value=>/\b(?:up to|maximum|at most|not more than)\b/i.test(positive)?value<=Math.min(...limits):limits.includes(value));
  return amountFits&&(!scope.length||!items.length||items.every(item=>scope.includes(item)));
 });
 return fits?[]:['The proposed discount amount or product/quotation scope exceeds the explicit active permission.'];
}
/** Full text goes to generation. This deterministic gate additionally enforces
 * recognizable authority actions, including offers disguised as hypotheticals.
 * Unknown free-form restrictions remain full instructions, never guessed away. */
export function configurationSuggestionProblems(say:string,context:ConfigurationContext):string[] {
 const stage=selectedConfigurationStage(context);if(!stage)return [];
 const problems:string[]=[];
 for(const clause of clauseParts(say))problems.push(...discountPermissionScopeProblems(clause,context));
 for(const clause of clauseParts(say)){
  if(denied(clause)||!/\b(?:approved|authorized|authorised|permitted)\b/i.test(clause)||/\b(?:no|not)\b.{0,45}\b(?:approved|authorized|authorised|permitted)\b/i.test(clause))continue;
  const authorityText=(text:string):ConfigurationBoundary=>({id:'current-approval-assertion',text,authority:'prohibited',scope:'company',status:'active',origin:'manager',action:'commercial_promise'});
  let actions=actionsOf(authorityText(clause));
  if(actions.every(action=>action==='commercial_promise'))actions=actionsOf(authorityText((context.turns||[]).findLast(turn=>turn.role==='buyer')?.text||''));
  for(const action of actions)if(action!=='commercial_promise'&&!configurationAuthorizesAction(context,action))problems.push('Current '+action+' approval cannot be asserted from company knowledge; this call has no applicable active permission.');
 }
 for(const boundary of activeConfigurationBoundaries(context)){
  if(boundary.authority==='allowed')continue;
  if(failedSampleConditionSatisfied(boundary,context)&&boundary.authority==='prohibited')continue;
  const conditionalApproval=/\bunapproved\b|\bunless\b.{0,40}\b(?:approved|authorized)\b|\bwithout\b.{0,40}\bapproval\b|\bonly\b.{0,40}\b(?:approved|authorized)\b/i.test(boundary.text);
  const blockedActions=actionsOf(boundary).filter(action=>!conditionalApproval||!activeConfigurationBoundaries(context).some(permission=>permission.authority==='allowed'&&permission.scope==='company'&&actionsOf(permission).includes(action)&&!permission.condition));
  if(clauseParts(say).some(clause=>blockedActions.some(action=>actionOffered(clause,action))))problems.push('Active '+boundary.scope+' boundary '+boundary.id+': '+boundary.text);
 }
 if(!callRouteAtRequest(context)?.routingNeeded&&!/cold.?call|first contact|reach.*purchas|purchas.*person|right.person/i.test(stage.id+' '+stage.name+' '+stage.objective)&&/\b(?:could I speak|who (?:handles|is in charge of)|are you (?:the|in charge))\b.{0,70}\b(?:purchasing|procurement)\b|\b(?:I'm|I am) (?:calling|with)\b.{0,70}\bdo you have a moment\b/i.test(say))problems.push('The selected '+stage.name+' stage must not be replaced by a cold-call routing/introduction script.');
 return problems;
}
export function configuredSafeReply(context:ConfigurationContext):string|undefined {
 const stage=selectedConfigurationStage(context);if(!stage)return;
 const latest=(context.turns||[]).findLast(turn=>turn.role==='buyer')?.text||'';
 const active=activeConfigurationBoundaries(context);
 if(/\b(?:not interested|no thanks|don't call|do not call|stop calling|don't contact|do not contact)\b/i.test(latest))return /call|contact/i.test(latest)?"Understood. I won't call again.":'Understood. Thanks for your time.';
 if(/sample/i.test(latest)&&active.some(boundary=>boundary.authority!=='allowed'&&actionOf(boundary)==='sample'&&!failedSampleConditionSatisfied(boundary,context)))return /failed|first|previous/i.test(active.map(item=>item.text).join(' '))?'Before discussing another sample, what caused the first one to fail?':"A sample needs approval; I can ask about that without promising it.";
 if(/discount|lower.*price|match.*price/i.test(latest))return configurationAuthorizesAction(context,'discount')?'We can proceed on the terms explicitly authorized for this quotation. Does that resolve your decision?':"I can't commit to a discount or price match without approval. What comparison are you working from?";
 if(/\b(?:what|which|how|give|confirm|tell)\b.{0,70}\b(?:price|purity|content|percentage|specification|pressure|MOQ|lead time|stock|certif\w*)\b/i.test(latest))return "I don't have that figure confirmed in the approved information. I'll check it before giving you a definite answer.";
 if(/technical|evaluation/i.test(stage.id+' '+stage.name))return "What would help your team resolve the technical question you're evaluating?";
 return "What would be the most useful next step from your perspective?";
}
/** Canned sales moves cannot interpret a custom stage playbook. Exact facts may
 * still use the documented-answer path, subject to the same authority checks. */
export const configurationNeedsInterpretation=(context:ConfigurationContext)=>!!selectedConfigurationStage(context)?.playbook.trim();
