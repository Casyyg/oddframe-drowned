"""Verify the deployed AWS URL. --exercise adds three labeled text-mode QA runs."""
import argparse, datetime, json, pathlib, urllib.request, urllib.error, uuid

ROOT=pathlib.Path(__file__).resolve().parents[1]

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--url')
    p.add_argument('--exercise',action='store_true')
    args=p.parse_args()
    deployment=json.loads((ROOT/'evidence/aws-deployment.json').read_text())
    base=(args.url or deployment['outputs']['WebsiteURL']).rstrip('/')
    if not base.startswith('https://'): raise RuntimeError('Expected the public HTTPS AWS URL.')
    results=[]
    def request(path,body=None,token=None,headers=None,method=None):
        h={'Origin':base,**(headers or {})}
        if token:h['Authorization']='Bearer '+token
        if body is not None:h['Content-Type']='application/json'
        req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=h,method=method)
        try:r=urllib.request.urlopen(req,timeout=45)
        except urllib.error.HTTPError as e:r=e
        data=r.read()
        return r.status,dict(r.headers),data
    def check(name,ok):
        results.append({'check':name,'passed':bool(ok)})
        if not ok:raise RuntimeError('Failed: '+name)
    def api(path,body=None,token=None):
        code,headers,data=request(path,body,token)
        check(path+' status',code in (200,201))
        check(path+' private response',headers.get('Cache-Control')=='no-store')
        return json.loads(data)
    try:
        for path in ['/','/drowned/','/insights/']:
            code,h,data=request(path)
            check(path+' page',code==200 and b'<html' in data.lower())
        for path in ['/play/','/stats/']:
            check(path+' retired',request(path)[0]==404)
        check('anonymous statistics rejected',request('/api/drowned/stats')[0]==401)
        check('invalid name rejected',request('/api/drowned/sessions',{'playerName':'  '})[0]==400)
        check('live DynamoDB',api('/api/health')['storage']=='DynamoDB')
        story=json.loads((ROOT/'public/media/drowned/story.json').read_text())
        files=sorted({s[k] for s in story['scenes'] for k in ['video','poster','captions'] if s.get(k)})
        for name in files:
            if name.endswith('.mp4'):
                code,h,data=request('/api/media/drowned/'+name,headers={'Range':'bytes=0-1023'})
                check(name+' range',code==206 and len(data)==1024 and h.get('Content-Range','').startswith('bytes 0-1023/'))
            else:check(name+' available',request('/media/drowned/'+name,method='HEAD')[0]==200)
        if args.exercise:
            runs=[]
            for ending in ['Check-In','Surface','Nameless']:
                name='AWS QA - '+ending+' (text)'
                s=api('/api/drowned/sessions',{'playerName':name})
                token=s['token']
                def event(kind,**extra):
                    nonlocal s
                    body={'type':kind,'sceneId':s['sceneId'],'requestId':str(uuid.uuid4()),**extra}
                    s=api('/api/drowned/events',body,token)
                for choice in ['descend','look','answer','register']:
                    event('read');event('choice',choiceId=choice)
                event('read')
                if ending=='Nameless':
                    event('line',value=False);event('choice',choiceId='erase');event('read');event('choice',choiceId='return')
                else:event('choice',choiceId='check-in' if ending=='Check-In' else 'surface')
                event('read')
                restored=api('/api/drowned/session',token=token)
                check(ending+' saved and restored',restored['ending']==ending and restored['playerName']==name)
                runs.append({'shortId':token[:8],'name':name,'ending':ending})
            secret=json.loads((ROOT/'data/aws-deployment-secrets.json').read_text())['adminToken']
            stats=api('/api/drowned/stats',token=secret)
            check('protected statistics work',all(stats['endings'].get(e,0)>=1 for e in ['Check-In','Surface','Nameless']))
            results.append({'qaRuns':runs,'note':'Text-mode protocol tests, not human viewing or physical phone tests.'})
        status='PASS'
    except Exception as e:
        status='FAIL'
        results.append({'error':str(e)[:200]})
    report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'url':base,'status':status,'checks':results}
    (ROOT/'evidence/aws-live-tests.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':status,'checks':len(results),'evidence':'evidence/aws-live-tests.json'}))
    return 0 if status=='PASS' else 1

if __name__=='__main__':raise SystemExit(main())
