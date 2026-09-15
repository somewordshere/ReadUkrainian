// Filter a complete raw Wiktextract download without holding it in memory.
import { createReadStream, createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { StringDecoder } from 'node:string_decoder';

const { values } = parseArgs({options:Object.fromEntries(['source','output','edition','revision','source-url'].map(k=>[k,{type:'string'}]))});
for (const key of ['source','output','edition','revision','source-url']) if (!values[key]) throw new Error(`--${key} is required`);
if (!['en','de'].includes(values.edition) || !/^\d{4}-\d{2}-\d{2}$/.test(values.revision)) throw new Error('Expected edition en|de and a YYYY-MM-DD source revision');
const inputHash=createHash('sha256'),outputHash=createHash('sha256');
let lines=0,entries=0;
const hashInput=new Transform({transform(chunk,encoding,callback){inputHash.update(chunk);callback(null,chunk);}});
const streams=[createReadStream(values.source),hashInput];
if(values.source.endsWith('.gz'))streams.push(createGunzip());
streams.push(async function* filter(input){
  const decoder=new StringDecoder('utf8');let pending='';
  async function* consume(line){
    lines++;if(!line.trim())return;
    let entry;try{entry=JSON.parse(line);}catch{throw new Error(`Invalid JSON at source line ${lines}: ${line.slice(0,80)}`);}
    if(entry.lang_code!=='uk')return;
    if(typeof entry.word!=='string'||typeof entry.pos!=='string')throw new Error(`Incomplete Ukrainian entry at line ${lines}`);
    const serialized=JSON.stringify(entry)+'\n';outputHash.update(serialized);entries++;yield serialized;
  }
  for await(const chunk of input){
    pending+=decoder.write(chunk);let offset;
    while((offset=pending.indexOf('\n'))!==-1){const line=pending.slice(0,offset);pending=pending.slice(offset+1);yield* consume(line);}
  }
  pending+=decoder.end();if(pending.trim())yield* consume(pending);
},createWriteStream(values.output,{flags:'wx'}));
await pipeline(...streams);
if(!entries)throw new Error('No Ukrainian entries extracted; output is not an accepted source');
const report={edition:values.edition,revision:values.revision,sourceUrl:values['source-url'],sourceSha256:inputHash.digest('hex'),filteredSha256:outputHash.digest('hex'),sourceLines:lines,ukrainianEntries:entries};
await writeFile(values.output+'.metadata.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));

