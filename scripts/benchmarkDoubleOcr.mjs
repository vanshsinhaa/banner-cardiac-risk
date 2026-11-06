// Local evaluation only. Digitizer mode deliberately measures the component
// directly, separate from the web privacy gate; never use it as a UI bypass.
// node --experimental-strip-types scripts/benchmarkDoubleOcr.mjs DATASET OUTPUT digitizer|privacy
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { computeHomography, outputCorners, warpRows } from '../src/lib/perspective.ts';
import { encodePng } from '../src/components/capture/encodePng.ts';
import { pngBlob } from '../src/lib/capturePipeline.ts';
const [dataset, output, stage = 'digitizer'] = process.argv.slice(2);
if (!dataset || !output || !['digitizer', 'privacy'].includes(stage)) throw new Error('Supply dataset directory, output JSONL and digitizer|privacy');
const manifest = JSON.parse(await fs.readFile(path.join(dataset, 'manifest.json'), 'utf8'));
const base = process.env.BENCHMARK_URL || 'http://127.0.0.1:3012';
const completed = new Set();
try { for (const line of (await fs.readFile(output, 'utf8')).trim().split('\n')) if (line) completed.add(JSON.parse(line).file); } catch {}
for (const item of manifest.images) {
  if (completed.has(item.file)) continue;
  const row = {file: item.file, category:item.file.split('__')[0], stage, sourceBytes:item.bytes, cropPolicy:'full-image, EXIF orientation applied; no manually selected corners', encoder:'production worker fallback encodePng'};
  const started = Date.now();
  console.log("Starting", item.file);
  try {
    const {data, info} = await sharp(path.join(dataset,item.file)).autoOrient().ensureAlpha().raw().toBuffer({resolveWithObject:true});
    row.width=info.width;row.height=info.height;
    const corners=outputCorners(info.width,info.height);
    const target={width:info.width,height:info.height,data:new Uint8ClampedArray(data.length)};
    warpRows({width:info.width,height:info.height,data:new Uint8ClampedArray(data.buffer,data.byteOffset,data.byteLength)},target,computeHomography(corners,corners),0,info.height);
    const blob=await encodePng(target);
    console.log("Encoded",item.file,blob.size);
    row.pngBytes=blob.size; row.oldLimitWouldBlock=blob.size>10*1024*1024;
    const dataUrl='data:image/png;base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');
    const validated=pngBlob(dataUrl);row.clientAccepted=true;
    console.log("Validated",item.file);
    const networkStart=Date.now();
    let body=validated, headers={'Content-Type':'image/png'}, endpoint='/api/ecg/digitize';
    if(stage==='privacy') { body=new FormData();body.append('file',validated,'ekg-capture.png');headers={};endpoint='/api/deidentify'; }
    const response=await fetch(base+endpoint,{method:'POST',body,headers,signal:AbortSignal.timeout(stage==='privacy'?65000:130000)});
    row.httpStatus=response.status;
    const result=await response.json();row.requestSeconds=(Date.now()-networkStart)/1000;
    if (!response.ok) {row.error=result.error;row.code=result.code;}
    else if(stage==='privacy') {
      row.privacyPassed=result.status==='redacted'&&!result.mock;row.regionsRedacted=result.regions_redacted;
      if(row.privacyPassed && process.env.BENCHMARK_REDACTED_DIR) {
        await fs.mkdir(process.env.BENCHMARK_REDACTED_DIR,{recursive:true});
        await fs.writeFile(path.join(process.env.BENCHMARK_REDACTED_DIR,item.file+'.png'),Buffer.from(await pngBlob(result.image).arrayBuffer()));
      }
    }
    else {
      row.extractedLeads=Object.keys(result.leads||{});row.leadCount=row.extractedLeads.length;
      row.verification=result.leadVerification?.status;row.requiresReview=result.requiresReview;
      row.checks=result.leadVerification?.leads;
      row.recheck=result.layoutRecheck;
      row.previewCount=Object.keys(result.leadPreviews||{}).length;
      row.samplingRateHz=result.samplingRateHz;
    }
  } catch(error) { row.error=error.message;row.errorName=error.name; }
  row.totalSeconds=(Date.now()-started)/1000;
  await fs.appendFile(output,JSON.stringify(row)+'\n');
  console.log(JSON.stringify({done:completed.size+1,file:row.file,pngMiB:row.pngBytes/1048576,http:row.httpStatus,leads:row.leadCount,verification:row.verification,error:row.error,seconds:row.totalSeconds}));
  completed.add(item.file);
}
