import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// Stored outside the project, encrypted for the current Windows user with DPAPI.
export const credentialFile=path.join(process.env.LOCALAPPDATA||process.env.TEMP||os.tmpdir(),'ChinoLive','secrets','google-video.dpapi');
const powerShell=path.join(process.env.ProgramFiles||'','PowerShell','7','pwsh.exe');
let cached,stamp;
export function googleVideoCredential(){
  if(process.platform!=='win32')return '';
  if(!fs.existsSync(credentialFile))return '';
  const modified=fs.statSync(credentialFile).mtimeMs;if(cached&&stamp===modified)return cached;
  const script="$ErrorActionPreference='Stop'; $s=Get-Content -Raw -LiteralPath $env:CHINO_CREDENTIAL_FILE | ConvertTo-SecureString; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }";
  const result=spawnSync(powerShell,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',timeout:10000,env:{...process.env,CHINO_CREDENTIAL_FILE:credentialFile}});
  if(result.status!==0)throw new Error('generation_credential_store_unavailable');
  let data;try{data=JSON.parse(result.stdout);}catch{throw new Error('generation_credential_store_invalid');}
  const value=data.keys?.[data.active];if(typeof value!=='string'||value.length<30)throw new Error('generation_credential_store_invalid');
  cached=value;stamp=modified;return value;
}
export function saveGoogleVideoCredentials(keys,active=0){
  if(process.platform!=='win32')throw new Error('generation_credential_store_platform_unsupported');
  if(!Array.isArray(keys)||!keys.length||!keys.every(k=>typeof k==='string'&&k.length>=30)||!keys[active])throw new Error('invalid_video_credentials');
  fs.mkdirSync(path.dirname(credentialFile),{recursive:true});
  const script="$ErrorActionPreference='Stop'; $reader=New-Object IO.StreamReader([Console]::OpenStandardInput()); $plain=$reader.ReadToEnd(); $secure=ConvertTo-SecureString -String $plain -AsPlainText -Force; $encoded=ConvertFrom-SecureString $secure; [IO.File]::WriteAllText($env:CHINO_CREDENTIAL_FILE,$encoded); $plain=$null";
  const result=spawnSync(powerShell,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',timeout:10000,input:JSON.stringify({version:1,active,keys}),env:{...process.env,CHINO_CREDENTIAL_FILE:credentialFile}});
  if(result.status!==0)throw new Error('generation_credential_store_write_failed');cached=null;stamp=null;
}
