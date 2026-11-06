import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateReply} from '../scripts/regression/evaluate-reply.mjs';

const investigation={move:'investigate_coverage',reference:'UP29',preserveReference:true};
const conditional={move:'conditional_send',reference:'UP29',preserveReference:true};

test('Independent rubric keeps an inquiry uncertain when a coordinated verb shares its subject',()=>{
 for(const say of [
  "If you email the drawing, I'll review it and confirm whether the inspection report covers UP29.",
  "I'll review your drawing and find out whether UP29 is covered by that report.",
  "I'll review the drawing and verify whether the report includes UP29.",
 ])assert.equal(evaluateReply(say,investigation).pass,true,say);
});

test('An inquiry does not exempt an adjoining affirmative coverage claim',()=>{
 for(const say of [
  "I'll review the drawing and confirm that the report covers UP29.",
  "I'll review it and check whether the report covers UP29, but our report already covers it.",
  "I'll find out whether the report covers UP29, and it definitely does.",
  "I'll review the drawing, and the report covers UP29.",
 ])assert.equal(evaluateReply(say,investigation).pass,false,say);
});

test('A result-conditional continuation may omit a repeated subject without losing its condition',()=>{
 const say="I'll check whether the inspection report covers UP29, and if it does, send it with my reply.";
 assert.equal(evaluateReply(say,conditional).pass,true);
});

test('Elliptical delivery still requires a positive result rather than completion or a negative result',()=>{
 for(const say of [
  "I'll check whether the report covers UP29, and once that is checked, send it with my reply.",
  "I'll check whether the report covers UP29, and if it does not, send it with my reply.",
  "I'll check whether the report covers UP29, and if it doesn't, send it with my reply.",
  "I'll check whether the report covers UP29, and if it does, send it with my reply. I'll forward it regardless.",
 ])assert.equal(evaluateReply(say,conditional).pass,false,say);
});
