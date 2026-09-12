"""Allowlisted, hash-verified AWS release. No credentials or player records."""
import hashlib
import json
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]

def release_files(root=ROOT):
    fixed = ['aws/deploy.py', 'aws/release.py', 'aws/template.json', 'aws/bootstrap.json',
             'aws/runtime/package.json', 'aws/runtime/package-lock.json', 'aws/smoke-test.py',
             'public/media/drowned/story.json']
    paths = [root / name for name in fixed]
    paths += [root / 'server' / name for name in ['index.mjs', 'store.mjs', 'errors.mjs', 'drowned.mjs']]
    paths += sorted(p for p in (root / 'dist/client').rglob('*') if p.is_file())
    for p in paths:
        if not p.is_file() or p.is_symlink():
            raise RuntimeError('Missing or unsafe release file: '+str(p.relative_to(root)))
    return paths

def verify_assets(root=ROOT):
    story = json.loads((root / 'public/media/drowned/story.json').read_text())
    expected = {'story.json'} | {s[k] for s in story['scenes'] for k in ['video','poster','captions'] if s.get(k)}
    actual = {p.relative_to(root / 'dist/client/media').as_posix() for p in (root / 'dist/client/media').rglob('*') if p.is_file()}
    if actual != {'drowned/'+name for name in expected}:
        raise RuntimeError('Public media must contain exactly the current elevator release.')
    for name in ['index.html','drowned.html','insights.html']:
        if not (root / 'dist/client' / name).is_file():
            raise RuntimeError('Missing current page: '+name)
    for name in ['play.html','stats.html']:
        if (root / 'dist/client' / name).exists():
            raise RuntimeError('Retired story page in release: '+name)
    # Compare compiled copies with the final source manifest and media.
    for name in expected:
        if hashlib.sha256((root/'dist/client/media/drowned'/name).read_bytes()).digest() != hashlib.sha256((root/'public/media/drowned'/name).read_bytes()).digest():
            raise RuntimeError('Stale compiled media: '+name)
    return len(expected)-1

def verify_manifest(root=ROOT):
    manifest = json.loads((root / 'aws/release-manifest.json').read_text())
    expected = {p.relative_to(root).as_posix() for p in release_files(root)}
    if set(manifest['sha256']) != expected:
        raise RuntimeError('Release manifest file list mismatch.')
    for name, digest in manifest['sha256'].items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
            raise RuntimeError('Release changed after verification: '+name)
    return manifest

def package():
    count=verify_assets()
    checks=json.loads((ROOT/'evidence/test-results.json').read_text())
    if checks.get('status') != 'PASS':
        raise RuntimeError('Run verification before packaging.')
    paths=release_files()
    manifest={'status':'LOCAL_VERIFIED_NOT_DEPLOYED','mediaAssets':count,'verificationTime':checks['recordedAt'],
              'sha256':{p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}}
    target=ROOT/'artifacts/oddframe-aws-release.zip'
    target.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as archive:
        for p in paths: archive.write(p,p.relative_to(ROOT).as_posix())
        archive.writestr('aws/release-manifest.json',json.dumps(manifest,indent=2)+'\n')
        archive.writestr('evidence/test-results.json',json.dumps(checks,indent=2)+'\n')
    print(json.dumps({'archive':str(target),'mediaAssets':count,'bytes':target.stat().st_size,
                      'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}))

if __name__=='__main__': package()
