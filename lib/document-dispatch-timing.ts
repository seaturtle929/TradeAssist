import {analyzeDocumentActionSyntax} from './document-action-syntax.ts';

/** A speed assurance attached to a proposed document dispatch. Recognizing
 * the action or its prerequisites does not authorize this extra commitment.
 * Direction alone ("over", "back") and spatial descriptions are not speed. */
export function immediateDocumentDispatchClaims(text:string):{text:string;start:number;end:number;actionStart:number}[]{
 return analyzeDocumentActionSyntax(text).flatMap(action=>{
  if(!action.documentDelivery||action.actor==='buyer'||!['commitment','offer'].includes(action.speechAct))return [];
  const from=action.voice==='passive'?action.end:action.object.end;
  const tail=text.slice(from,action.scope.end);
  const match=/^\s*((?:right|straight)\s+(?:over|back|along))(?=\s*(?:to\b|as\b|if\b|once\b|after\b|when\b|provided\b|[,.!?;]|$))/i.exec(tail);
  if(!match)return [];
  const start=from+match[0].indexOf(match[1]);
  return [{text:match[1],start,end:start+match[1].length,actionStart:action.start}];
 });
}
