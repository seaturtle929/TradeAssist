import { readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url)).replace(/\/$/,"");
const pidPath=fileURLToPath(new URL("../.sites-runtime/app.pid",import.meta.url));
try {
 const pid=Number(readFileSync(pidPath,"utf8"));
 if(!Number.isInteger(pid)||pid<2)throw new Error("Invalid app PID.");
 const command=spawnSync("ps",["-p",String(pid),"-o","command="],{encoding:"utf8"}).stdout || "";
 const cwd=spawnSync("/usr/sbin/lsof",["-a","-p",String(pid),"-d","cwd","-Fn"],{encoding:"utf8"}).stdout || "";
 if(!command.includes("scripts/run-framework.mjs dev") || !cwd.split("\n").includes("n"+root)) {unlinkSync(pidPath);console.log("The recorded app process is no longer running.");process.exit(0);}
 process.kill(pid,"SIGTERM");unlinkSync(pidPath);console.log("Trade Assist stopped.");
} catch(error) {if(error.code==="ENOENT"||error.code==="ESRCH")console.log("Trade Assist is not running.");else throw error;}
