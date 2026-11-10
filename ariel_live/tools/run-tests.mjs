import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tests=fs.readdirSync(root).filter(n=>n.endsWith('.test.mjs')).sort();
const result=spawnSync(process.execPath,['--test',...tests],{cwd:root,stdio:'inherit'});process.exitCode=result.status??1;
