import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function bootstrap(root,{dryRun=false}={}){
 const source=path.join(root,'portable','seeds'),created=[],preserved=[];
 function copy(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const from=path.join(dir,entry.name);if(entry.isDirectory()){copy(from);continue;}
  const relative=path.relative(source,from);if(relative==='snapshot.json')continue;
  const target=path.join(root,'data',relative);if(fs.existsSync(target)){preserved.push(relative);continue;}
  if(!dryRun){fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(from,target,fs.constants.COPYFILE_EXCL);}created.push(relative);
 }}
 copy(source);
 const config=path.join(root,'data','performer-config.json');
 if(!fs.existsSync(config)){
  const value={threeRoot:path.join(root,'node_modules','three'),asset:path.join(root,'data','performer','seated-wardrobe','lion_original_wardrobe.glb'),setAsset:path.join(root,'data','performer','seated-denim-chair','royal-throne.glb'),designAsset:path.join(root,'data','performer','royal-hero-v12','royal-lion-hero-v12.glb')};
  if(!dryRun){fs.mkdirSync(path.dirname(config),{recursive:true});fs.writeFileSync(config,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}created.push('performer-config.json');
 }else preserved.push('performer-config.json');
 return {created,preserved,secretsCopied:false,paidGenerationStarted:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(bootstrap(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),{dryRun:process.argv.includes('--dry-run')}),null,2));
