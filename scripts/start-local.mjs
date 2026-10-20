import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root=fileURLToPath(new URL("../",import.meta.url));
const base="http://127.0.0.1:5173";
async function ready(){try{const r=await fetch(base+"/api/health",{signal:AbortSignal.timeout(1000)});return r.ok && (await r.json()).app==="Trade Assist";}catch{return false;}}
if(await ready()){console.log("Trade Assist is already running at "+base);process.exit(0);}
if(!existsSync(path.join(root,".env.local")))throw new Error("The secure local AI connection is missing. Return to Codex to reconnect it.");
const runtime=path.join(root,".sites-runtime");mkdirSync(runtime,{recursive:true});
const out=openSync(path.join(runtime,"app.log"),"a",0o600);
const child=spawn(process.execPath,["--env-file=.env.local","scripts/run-framework.mjs","dev"],{cwd:root,detached:true,stdio:["ignore",out,out],env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH}});
child.unref();writeFileSync(path.join(runtime,"app.pid"),String(child.pid),{mode:0o600});
for(let attempt=0;attempt<45;attempt++){if(await ready()){console.log("Trade Assist is running in the background at "+base);console.log("You can close Terminal. To stop it, run node scripts/stop-local.mjs from the app folder.");process.exit(0);}await new Promise(r=>setTimeout(r,1000));}
throw new Error("The app did not start. See .sites-runtime/app.log for the error.");
