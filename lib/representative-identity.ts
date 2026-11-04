import type {CoachingContext} from './call-coaching';

export type RepresentativeIdentity={name:string;source:'representative_speech'|'rep_profile'|'call_context'|'manager_preference';quote:string;turnId?:string};
const excluded=new Set(["i'm",'i','a','an','the','with','from','calling','here','glad','happy','sorry','ready','interested','following','checking','reaching','representing','speaking','regarding','about','going','looking']);
const normalize=(value:string)=>value.replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
const validName=(value:string)=>!!value&&value.split(/\s+/).length<=3&&value.split(/\s+/).every(word=>/^[A-Z][a-zA-Z'-]*$/.test(word)&&!excluded.has(word.toLowerCase()));
const nameFrom=(value:string,declared=false)=>{
 const line=normalize(value);
 const prefix=declared?/\b(?:(?:my|(?:the )?(?:salesperson|representative|rep)(?:'s)?) name is|(?:the )?(?:salesperson|representative|rep) is|(?:salesperson|representative|rep) name\s*:)\s+/gi:/\b(?:this is|I'm|I am|my name is)\s+/gi;
 for(const match of line.matchAll(prefix)){
  const name=line.slice((match.index||0)+match[0].length).match(/^([A-Z][a-zA-Z'-]*(?:\s+[A-Z][a-zA-Z'-]*){0,2})(?=[,.;!?]|\s+(?:from|with|at|and)|$)/)?.[1];
  if(name&&validName(name))return name;
 }
 if(!declared){
  const spoken=/(?:^|[.!?,]\s*)(?:(?:[Hh]i|[Hh]ello|[Hh]ey|[Gg]ood morning|[Gg]ood afternoon)[,!. ]+)?([A-Z][a-zA-Z'-]*(?:\s+[A-Z][a-zA-Z'-]*){0,2})\s+(?:here|speaking)(?=[,.;!?]|\s+(?:from|with|at|and)|$)/g;
  for(const match of line.matchAll(spoken))if(validName(match[1]))return match[1];
 }
};

/** Rep identity is an explicit declaration, not a buyer name, generated draft,
 * style example, company document author or a guess from an earlier call. */
export function representativeIdentityFor(context:CoachingContext):RepresentativeIdentity|undefined {
 for(const turn of [...context.turns||[]].reverse()){
  if(turn.role!=='you'||turn.transcriptionUncertainty)continue;
  const name=nameFrom(turn.text);if(name&&name.toLowerCase()!==context.manufacturer?.name?.toLowerCase())return {name,source:'representative_speech',quote:turn.text,turnId:turn.id};
 }
 const notes=(context.voice as {notes?:string}|undefined)?.notes;
 for(const [source,text] of [['rep_profile',notes],['call_context',context.callContext?.knownFacts],['call_context',context.callContext?.background]] as const){
  if(!text)continue;const name=nameFrom(text,true);if(name)return {name,source,quote:text};
 }
 for(const preference of context.companyConfiguration?.snapshot.preferences||[]){
  if(preference.origin!=='manager')continue;const name=nameFrom(preference.text,true);if(name)return {name,source:'manager_preference',quote:preference.text};
 }
}

export function representativeIdentityRules(context:CoachingContext):string {
 const identity=representativeIdentityFor(context);
 return identity?'VERIFIED REPRESENTATIVE IDENTITY: '+JSON.stringify(identity)+'. Use only this declared rep name when an introduction is needed. The selected contact and current buyer speaker are different people from the rep.':'REPRESENTATIVE IDENTITY UNKNOWN: No verified salesperson name is available for this request. Introduce the supplied company with “I’m with [company]” and OMIT a personal name. Never fill the gap from an example, a buyer/contact name or a previous generated draft.';
}

export function representativeIdentityProblems(say:string,context:CoachingContext):string[]{
 const candidate=nameFrom(say);if(!candidate)return [];
 if(candidate.toLowerCase()===context.manufacturer?.name?.toLowerCase())return [];
 const known=representativeIdentityFor(context),same=known&&(candidate.toLowerCase()===known.name.toLowerCase()||candidate.toLowerCase()===known.name.split(/\s+/)[0].toLowerCase());
 return same?[]:[known?`The spoken salesperson name ${candidate} is not the verified representative name ${known.name}. Use the verified name or omit the personal name.`:'No verified salesperson name is available. Omit the invented personal name and introduce the supplied company.'];
}
