import {mkdtemp,mkdir,readFile,writeFile,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {suite,holdoutConversations,negativeControls,pairedControls} from './regression/conversation-fixtures.mjs';
import {evaluateReply} from './regression/evaluate-reply.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2),option=(name,fallback)=>args.find(arg=>arg.startsWith(name+'='))?.slice(name.length+1)||fallback;
if(args.includes('--help')){
 console.log('npm run check:conversations -- --baseline=fb8e23c --candidate=working [--fixtures=outputs/private-cases.json] [--holdouts] [--out=outputs/conversation-regression]\nOffline only. Source builds run in disposable child processes with scripted provider events; no AI calls or browser writes. Candidate may be a Git revision. Reports separate correctness from unmeasured live latency.');process.exit(0);
}
const baseline=option('--baseline','fb8e23c'),candidate=option('--candidate','working');
const output=path.resolve(root,option('--out','outputs/conversation-regression/run-'+new Date().toISOString().replace(/[:.]/g,'-')));
if(path.relative(path.join(root,'outputs'),output).startsWith('..'))throw new Error('Reports must stay inside ignored outputs/');
await mkdir(output,{recursive:true});
try{await readFile(path.join(output,'comparison.private.json'));throw new Error('This report directory already contains a comparison. Choose a new --out path to preserve it.');}catch(error){if(error.code!=='ENOENT')throw error;}
const git=(...params)=>{const result=spawnSync('git',params,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});if(result.status!==0)throw new Error(result.stderr);return result.stdout.trim();};
const temporary=await mkdtemp(path.join(tmpdir(),'tradeassist-conversation-regression-'));
const sources=new Map();
async function sourceFor(ref){
 if(ref==='working')return root;
 const commit=git('rev-parse','--verify',ref+'^{commit}');
 if(sources.has(commit))return sources.get(commit);
 const destination=path.join(temporary,commit);await mkdir(destination,{recursive:true});
 const archive=spawnSync('git',['archive',commit,'lib'],{cwd:root,maxBuffer:32*1024*1024});if(archive.status!==0)throw new Error(String(archive.stderr));
 const extracted=spawnSync('tar',['-xf','-','-C',destination],{input:archive.stdout});if(extracted.status!==0)throw new Error(String(extracted.stderr));
 await symlink(path.join(root,'node_modules'),path.join(destination,'node_modules'),'dir');sources.set(commit,destination);return destination;
}
async function fingerprint(directory){
 const entries=[];
 async function walk(folder){for(const entry of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const location=path.join(folder,entry.name);if(entry.isDirectory())await walk(location);else if(/\.[cm]?[jt]sx?$/.test(entry.name))entries.push([path.relative(directory,location),createHash('sha256').update(await readFile(location)).digest('hex')]);}}
 await walk(path.join(directory,'lib'));return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
const fixtureInput=option('--fixtures',null);
if(fixtureInput&&path.relative(path.join(root,'outputs'),path.resolve(root,fixtureInput)).startsWith('..'))throw new Error('Private fixtures must remain under ignored outputs/');
const fixture=fixtureInput?JSON.parse(await readFile(path.resolve(root,fixtureInput),'utf8')):structuredClone(suite);
if(!fixtureInput){
 for(const control of [...negativeControls,...pairedControls]){
  const original=suite.conversations.find(item=>item.id===control.conversationId),copy=structuredClone(original);
  const index=copy.steps.findIndex(step=>step.press?.id===control.atPress);
  if(index<0)throw new Error('Control targets a missing moment: '+control.id);
  copy.id='control-'+control.id;copy.name='Paired control: '+control.id;copy.category='control';copy.steps=copy.steps.slice(0,index+1);
  for(const step of copy.steps)delete step.press;
  copy.steps.at(-1).press={id:copy.id,candidates:[control.say,control.say],rubric:control.rubric,expect:control.expected==='usable'?'usable':'blocked',evaluationCategory:control.expected==='wrong_move'?'behavior':'safety'};
  fixture.conversations.push(copy);
 }
}
if(args.includes('--holdouts'))fixture.conversations.push(...structuredClone(holdoutConversations));
const requestIds=fixture.conversations.flatMap(conversation=>conversation.steps.filter(step=>step.press).map(step=>step.press.id));
if(new Set(requestIds).size!==requestIds.length)throw new Error('Every intentional fixture press must have a unique id');
const fixturePath=path.join(output,'cases.private.json');await writeFile(fixturePath,JSON.stringify(fixture,null,2));
const fixtureHash=createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
const runs=[];
const childEnv=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/OPENAI|API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|NODE_OPTIONS/i.test(name)));
for(const [label,ref] of [['baseline',baseline],['candidate',candidate]]){
 const directory=await sourceFor(ref),resultPath=path.join(output,label+'.private.json');
 const child=spawnSync(process.execPath,['--no-warnings','--experimental-loader',path.join(root,'scripts/regression/typescript-loader.mjs'),path.join(root,'scripts/regression/conversation-worker.mjs'),directory,fixturePath,resultPath],{cwd:directory,env:childEnv,encoding:'utf8',maxBuffer:8*1024*1024,timeout:120000});
 if(child.status!==0)throw new Error(label+' worker failed: '+child.stderr+'\n'+child.stdout);
 const result=JSON.parse(await readFile(resultPath,'utf8'));
 result.identity={requestedRef:ref,commit:ref==='working'?git('rev-parse','HEAD'):git('rev-parse',ref+'^{commit}'),workingChanges:ref==='working'?git('diff','--name-only'):null,sourceSha256:await fingerprint(directory)};
 await writeFile(resultPath,JSON.stringify(result,null,2));runs.push({label,...result});
 const core=result.groups.filter(group=>group.category!=='control'),controls=result.groups.filter(group=>group.category==='control');
 console.log(`${label}: conversations ${core.reduce((sum,row)=>sum+row.correct,0)}/${core.reduce((sum,row)=>sum+row.moments,0)} correct; controls ${controls.reduce((sum,row)=>sum+row.correct,0)}/${controls.reduce((sum,row)=>sum+row.moments,0)}; ${result.summary.unavailable} unavailable usable replies; ${result.summary.retries} repairs; live latency unmeasured; $0 API cost`);
}
const selfTests=[...negativeControls,...pairedControls,...(fixture.evaluatorControls||[])].map(control=>{const result=evaluateReply(control.say,control.rubric),expectedPass=control.expected==='usable';return {id:control.id,expectedPass,actualPass:result.pass,pass:result.pass===expectedPass,failures:result.failures,wording:control.say};});
const previous=new Map(runs[0].conversations.flatMap(conversation=>conversation.rows.map(row=>[row.id,row])));
const differences=runs[1].conversations.flatMap(conversation=>conversation.rows.map(row=>{const before=previous.get(row.id);return {conversation:conversation.name,id:row.id,before:before?.correct,after:row.correct,change:before?.correct===row.correct?'unchanged':row.correct?'improved':'regressed',beforeWording:before?.wording,afterWording:row.wording,beforeRejections:before?.issues,afterRejections:row.issues,beforeCalls:{generation:before?.providerRequests,repairs:before?.retries,verification:before?.verifierCalls},afterCalls:{generation:row.providerRequests,repairs:row.retries,verification:row.verifierCalls},beforeIdentityOutcomes:before?.identityOutcomes,afterIdentityOutcomes:row.identityOutcomes,beforeErrors:before?.errors,afterErrors:row.errors};}));
const report={schemaVersion:1,at:new Date().toISOString(),mode:'offline-scripted-transport',sourceBuilds:runs.map(({label,identity,summary,groups})=>({label,identity,summary,groups})),fixtureSha256:fixtureHash,
 expectedBehaviorsOutsideInput:true,apiCalls:0,userStorageTouched:false,temporarySourceCopies:temporary,
 limitations:['Scripted candidates and scripted remote-verifier responses are not fresh model behavior.','Offline controller wall time is not buyer-last-word-to-screen latency.','Only an isolated browser+recorded-audio comparison can establish live latency and model sales judgment.'],
 detectorSelfTests:selfTests,differences,regressions:differences.filter(row=>row.change==='regressed'),remainingFailures:runs[1].conversations.flatMap(conversation=>conversation.rows.filter(row=>!row.correct).map(row=>({conversation:conversation.name,...row}))),
 publishedSafetyFailures:runs[1].conversations.flatMap(conversation=>conversation.rows.filter(row=>row.wording&&((row.expect==='blocked'&&row.evaluationCategory!=='behavior')||row.policy?.unsupportedClaims?.length||row.evaluation.failures.some(value=>/positive coverage|buyer approval/.test(value.name)))).map(row=>({conversation:conversation.name,...row}))),runs};
const preflightFiles=['tests/live-transcript-completion-lifecycle.test.mjs','tests/live-repair-cancellation.test.mjs','tests/conversation-release-rubric.test.mjs','tests/coaching-feedback-vs-blocking.test.mjs','tests/conditional-courtesy-result-gates.test.mjs'];
const preflight=spawnSync(process.execPath,['--no-warnings','--experimental-loader',path.join(root,'scripts/regression/typescript-loader.mjs'),'--test',...preflightFiles],{cwd:root,env:childEnv,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
report.lifecyclePreflight={testedBuild:'working',files:preflightFiles,pass:preflight.status===0,output:preflight.stdout+'\n'+preflight.stderr};
await writeFile(path.join(output,'lifecycle-preflight.private.txt'),report.lifecyclePreflight.output);
await writeFile(path.join(output,'comparison.private.json'),JSON.stringify(report,null,2));
const escape=value=>String(value??'—').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const rows=differences.map(row=>`<tr><td>${escape(row.conversation)}<br>${escape(row.id)}</td><td>${row.before?'PASS':'FAIL'}<p>${escape(row.beforeWording)}</p><pre>${escape(JSON.stringify({identity:row.beforeIdentityOutcomes,calls:row.beforeCalls,rejected:row.beforeRejections,errors:row.beforeErrors},null,2))}</pre></td><td>${row.after?'PASS':'FAIL'}<p>${escape(row.afterWording)}</p><pre>${escape(JSON.stringify({identity:row.afterIdentityOutcomes,calls:row.afterCalls,rejected:row.afterRejections,errors:row.afterErrors},null,2))}</pre></td><td>${escape(row.change)}</td></tr>`).join('');
await writeFile(path.join(output,'REPORT.private.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>TradeAssist conversation regression comparison</title><style>body{font:16px system-ui;margin:32px;line-height:1.5;color:#172033}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbc5d4;padding:12px;vertical-align:top}pre{white-space:pre-wrap;font-size:12px}p{max-width:80ch}</style><h1>Conversation regression comparison</h1><p>OFFLINE SCRIPTED TRANSPORT — not observed live-model output. Real production Suggest next move controller and validation; no network, paid calls, browser storage or screen timing. Expected behavior remains outside request input.</p><pre>${escape(JSON.stringify(report.sourceBuilds,null,2))}</pre><h2>Detector self-check</h2><pre>${escape(JSON.stringify(selfTests,null,2))}</pre><h2>Every intentional press</h2><table><thead><tr><th>Moment</th><th>Baseline</th><th>Candidate</th><th>Change / rejected drafts</th></tr></thead><tbody>${rows}</tbody></table><h2>Remaining failures</h2><pre>${escape(JSON.stringify(report.remainingFailures.map(({id,wording,errors,issues,evaluation})=>({id,wording,errors,issues,evaluation})),null,2))}</pre><p>Live 1.8-second target: NOT MEASURED. Offline cost: $0. Full raw snapshots, drafts, rejection reasons, simulated verification requests and source fingerprints are in comparison.private.json.</p></html>`);
console.log('Report: '+path.join(output,'REPORT.private.html'));
process.exitCode=report.remainingFailures.length||report.regressions.length||report.publishedSafetyFailures.length||selfTests.some(row=>!row.pass)||!report.lifecyclePreflight.pass?1:0;
