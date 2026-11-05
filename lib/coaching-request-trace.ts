import type {CoachingRequestFocus} from './coaching-context-snapshot';
import type {CoachingRequest} from './on-demand-coaching';
import type {CallParticipant} from './call-participant';

/** One intentional request's diagnostics, never speech or client memory. */
export type CoachingRequestTrace={
 requestId:string;suggestionId:string;at:number;attempt:number;
 event:'speculation_started'|'speculation_accepted'|'speculation_discarded'|'turn_continued'|'queued'|'queue_wait_timeout'|'queue_released'|'queue_cancelled'|'requested'|'provider_request'|'candidate'|'format_recovered'|'verification_started'|'verification_complete'|'repair_requested'|'published'|'rejected'|'failed'|'cancelled'|'superseded';
 say?:string;rawText?:string;reason?:string;status?:string;
 focus?:CoachingRequestFocus;
 snapshot?:{request:CoachingRequest;turns:{id?:string;at?:number;role:string;text:string}[];participant:CallParticipant};
};
