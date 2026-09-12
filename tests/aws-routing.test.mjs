import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import {pageHandler,mediaHandler,cloudFrontSource} from '../aws/edge-functions.mjs';

const template=JSON.parse(readFileSync(new URL('../aws/template.json',import.meta.url)));
const run=(source,uri,method='GET')=>vm.runInNewContext(source+';handler(event)',{event:{request:{uri,method,headers:{range:{value:'bytes=0-1023'}}}}});
test('AWS pages: current exported routes resolve, retired routes return 404',()=>{
  const source=template.Resources.RoutesFunction.Properties.FunctionCode;
  assert.equal(source,cloudFrontSource(pageHandler));
  for(const [uri,file] of Object.entries({'/':'/index.html','/drowned':'/drowned.html','/drowned/':'/drowned.html','/insights':'/insights.html','/insights/':'/insights.html'}))assert.equal(run(source,uri).uri,file);
  for(const uri of ['/play','/play/','/stats','/stats/'])assert.equal(run(source,uri).statusCode,404);
  assert.equal(run(source,'/assets/main.js').uri,'/assets/main.js');
});
test('AWS media: specific S3 behavior precedes API and preserves Range',()=>{
  const behaviors=template.Resources.Distribution.Properties.DistributionConfig.CacheBehaviors;
  assert.equal(behaviors[0].PathPattern,'/api/media/drowned/*');
  assert.equal(behaviors[0].TargetOriginId,'content');
  assert.equal(behaviors[0].Compress,false);
  assert.equal(behaviors[0].FunctionAssociations[0].FunctionARN['Fn::GetAtt'][0],'MediaFunction');
  assert.equal(behaviors[1].PathPattern,'/api/*');
  assert.equal(behaviors[1].TargetOriginId,'api');
  assert.equal(behaviors[1].CachePolicyId,'4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
  const source=template.Resources.MediaFunction.Properties.FunctionCode;
  assert.equal(source,cloudFrontSource(mediaHandler));
  const manifest=JSON.parse(readFileSync(new URL('../public/media/drowned/story.json',import.meta.url)));
  for(const s of manifest.scenes.filter(s=>s.video))for(const method of ['GET','HEAD']){
    const result=run(source,'/api/media/drowned/'+s.video,method);
    assert.equal(result.uri,'/media/drowned/'+s.video);
    assert.equal(result.headers.range.value,'bytes=0-1023');
    assert.equal(result.method,method);
    assert.ok(existsSync(new URL('../public'+result.uri,import.meta.url)));
  }
  for(const uri of ['/api/media/drowned/../secret','/api/media/drowned/%2e%2e/a.mp4','/api/media/drowned/story.json'])assert.equal(run(source,uri).statusCode,404);
});
test('AWS protections: private S3, origin secret, database TTL, logs and alarm remain',()=>{
  const r=template.Resources;
  assert.ok(Object.values(r.Content.Properties.PublicAccessBlockConfiguration).every(Boolean));
  assert.equal(r.Sessions.Properties.TimeToLiveSpecification.Enabled,true);
  assert.equal(r.Backend.Properties.MetadataOptions.HttpTokens,'required');
  assert.equal(r.AppLogs.Properties.RetentionInDays,7);
  assert.equal(r.CpuAlarm.Type,'AWS::CloudWatch::Alarm');
  const api=r.Distribution.Properties.DistributionConfig.Origins.find(o=>o.Id==='api');
  assert.equal(api.OriginCustomHeaders[0].HeaderName,'X-Origin-Secret');
});
