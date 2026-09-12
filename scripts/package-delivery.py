"""Package source, media, built frontend and honest evidence, never local data."""
from pathlib import Path
import hashlib,json,shutil,zipfile,datetime
ROOT=Path(__file__).resolve().parents[1]
OUT=Path('/Users/casgao/Documents/Codex/2026-09-04/ban/outputs')
DEST=OUT/'OddFrame_Playable'
ALLOW=['app','components','hooks','lib','server','public','tests','scripts','aws','docs','evidence','dist/client','.openai','README.md','package.json','package-lock.json','tsconfig.json','next.config.ts','vite.config.ts','components.json','.gitignore','.oxfmtrc.json','.oxlintrc.json','env.example','Start OddFrame.command']
if DEST.exists():raise SystemExit('Delivery folder already exists; inspect it before replacing anything.')
DEST.mkdir(parents=True)
for entry in ALLOW:
    source=ROOT/entry;target=DEST/entry
    if source.is_dir():shutil.copytree(source,target,ignore=shutil.ignore_patterns('__pycache__','*.pyc','node_modules'))
    else:target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
files=[]
for path in sorted(DEST.rglob('*')):
    if path.is_file():files.append({'path':path.relative_to(DEST).as_posix(),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
manifest={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'Local playable build; AWS deployment pending account authorization','files':files,'excluded':['private local database','session bearer tokens','AWS credentials and deployment secrets','node_modules','scratch files'],'reportQA':{'pages':6,'visualInspection':'All six final rendered pages inspected; heading placement corrected; no observed clipping or overlaps.'}}
(DEST/'delivery-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
archive=OUT/'OddFrame_Playable_Local_AWS.zip'
if archive.exists():raise SystemExit('Archive already exists; inspect before replacing it.')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for path in sorted(DEST.rglob('*')):
        if path.is_file():z.write(path,arcname='OddFrame_Playable/'+path.relative_to(DEST).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert not any('/data/' in name or '/node_modules/' in name or '__pycache__' in name for name in z.namelist())
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'files':len(files),'report':str(DEST/'docs/OddFrame_Technical_Report_DRAFT.pdf')},indent=2))
