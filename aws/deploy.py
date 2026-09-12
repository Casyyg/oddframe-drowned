"""Explicitly gated AWS deployment. Default invocation is read-only preflight."""
import argparse, datetime, hashlib, json, mimetypes, os, pathlib, secrets, subprocess, tarfile, time, urllib.request
import boto3
from botocore.exceptions import BotoCoreError, ClientError
from release import verify_manifest

ROOT = pathlib.Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'evidence'

def save(name, value):
    EVIDENCE.mkdir(exist_ok=True)
    (EVIDENCE / name).write_text(json.dumps(value, indent=2, default=str) + '\n')

def wait_stack(cfn, name, timeout=1500):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        stack = cfn.describe_stacks(StackName=name)['Stacks'][0]
        status = stack['StackStatus']
        if status != last:
            print(name, status, flush=True)
            last = status
        if status in ('CREATE_COMPLETE', 'UPDATE_COMPLETE'):
            return {x['OutputKey']: x['OutputValue'] for x in stack.get('Outputs', [])}
        if 'FAILED' in status or 'ROLLBACK' in status or status.startswith('DELETE'):
            save('aws-stack-failure.json', cfn.describe_stack_events(StackName=name)['StackEvents'])
            raise RuntimeError('Stack failed. Inspect evidence/aws-stack-failure.json; do not retry blindly.')
        time.sleep(15)
    raise RuntimeError('Stack is still pending. Inspect it in AWS before retrying.')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile')
    parser.add_argument('--region', default='ap-southeast-2')
    parser.add_argument('--stack', default='oddframe-drowned')
    parser.add_argument('--instance-type', choices=['t2.micro','t3.micro'], default='t3.micro')
    parser.add_argument('--execute', action='store_true', help='Create AWS resources only after account-review.json approval')
    args = parser.parse_args()
    import re
    if not re.fullmatch('[a-z][a-z0-9-]{2,39}', args.stack):
        raise SystemExit('Choose a lowercase stack name, 3-40 characters.')
    os.environ.setdefault('AWS_EC2_METADATA_DISABLED', 'true')
    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    report = {'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'region':args.region, 'deployment':'NOT_DEPLOYED', 'accountEligibility':'UNVERIFIED'}
    if not session.get_credentials():
        report['blocker']='No local AWS credentials. Sign in locally; never paste access keys into chat.'
        save('aws-preflight.json', report)
        print(report['blocker']); return 2
    try:
        identity = session.client('sts').get_caller_identity()
        report['accountId'] = identity['Account']
        free = session.client('freetier', region_name='us-east-1')
        try:
            report['freeTierUsage'] = free.get_free_tier_usage(maxResults=100)
            if 'GetAccountPlanState' in free.meta.service_model.operation_names:
                report['accountPlan'] = free.get_account_plan_state()
        except (ClientError, BotoCoreError) as e:
            report['billingReadStatus'] = type(e).__name__
        ec2 = session.client('ec2')
        instance = ec2.describe_instance_types(InstanceTypes=[args.instance_type])['InstanceTypes'][0]
        report['instanceType'] = args.instance_type
        report['instanceMarkedEligible'] = instance.get('FreeTierEligible')
        prefix = ec2.describe_managed_prefix_lists(Filters=[{'Name':'prefix-list-name','Values':['com.amazonaws.global.cloudfront.origin-facing']}])['PrefixLists'][0]['PrefixListId']
        report['cloudFrontPrefixListAvailable'] = True
        cfn = session.client('cloudformation')
        for name in ['template.json','bootstrap.json']:
            cfn.validate_template(TemplateBody=(ROOT/'aws'/name).read_text())
        report['templatesValidatedByAWS'] = True
        save('aws-preflight.json', report)
        print('Read-only checks saved. Free Tier eligibility still requires the account review.', flush=True)
        if not args.execute:
            return 0
        verify_manifest()
        review = json.loads((ROOT/'aws/account-review.json').read_text())
        if not (review.get('approved') is True and review.get('accountId') == identity['Account'] and review.get('region') == args.region and review.get('instanceType') == args.instance_type and review.get('reviewedOn') == datetime.date.today().isoformat()):
            raise RuntimeError('Complete today\'s account-review.json for this account, region and instance type before deployment.')
        if not all(review.get(k) for k in ['creditsAndExpiryChecked','aggregateFreeUsageChecked','ipv4AndEbsChecked','budgetAlertsEnabled','publicDemoApproved']):
            raise RuntimeError('All cost and public-demo review checks must be confirmed.')
        verified = json.loads((EVIDENCE/'test-results.json').read_text())
        if verified['status'] != 'PASS':
            raise RuntimeError('Local verification must pass before deployment.')
        private = ROOT/'data';private.mkdir(exist_ok=True)
        secret_path=private/'aws-deployment-secrets.json'
        if secret_path.exists(): raise RuntimeError('Saved deployment secrets exist. Inspect the previous attempt before continuing.')
        # New deployment only. Never overwrite an existing stack or rotate its secrets accidentally.
        try:
            cfn.describe_stacks(StackName=args.stack)
        except ClientError as e:
            if 'does not exist' not in str(e): raise
        else:
            raise RuntimeError('This stack already exists. Inspect and plan an update instead of redeploying.')
        bootstrap = args.stack+'-artifacts'
        try:
            cfn.describe_stacks(StackName=bootstrap)
        except ClientError as e:
            if 'does not exist' not in str(e): raise
            cfn.create_stack(StackName=bootstrap, TemplateBody=(ROOT/'aws/bootstrap.json').read_text(), Tags=[{'Key':'Project','Value':'OddFrame'}])
        artifact_bucket = wait_stack(cfn, bootstrap)['ArtifactBucket']
        artifact = ROOT/'artifacts/backend.tar.gz'; artifact.parent.mkdir(exist_ok=True)
        with tarfile.open(artifact, 'w:gz') as archive:
            for name in ['index.mjs','store.mjs','errors.mjs','drowned.mjs']:
                archive.add(ROOT/'server'/name, arcname='server/'+name)
            archive.add(ROOT/'public/media/drowned/story.json', arcname='public/media/drowned/story.json')
            for filename in ['package.json','package-lock.json']: archive.add(ROOT/'aws/runtime'/filename, arcname=filename)
        digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
        artifact_key='builds/'+digest+'/backend.tar.gz'
        s3=session.client('s3');s3.upload_file(str(artifact),artifact_bucket,artifact_key,ExtraArgs={'ServerSideEncryption':'AES256'})
        admin, origin = secrets.token_hex(32), secrets.token_hex(32)
        with open(os.open(secret_path, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600), 'w') as f:
            json.dump({'stack':args.stack,'adminToken':admin,'originSecret':origin},f)
        params={'ArtifactBucket':artifact_bucket,'ArtifactKey':artifact_key,'CloudFrontPrefixListId':prefix,'InstanceType':args.instance_type,'AdminToken':admin,'OriginSecret':origin}
        cfn.create_stack(StackName=args.stack,TemplateBody=(ROOT/'aws/template.json').read_text(),Parameters=[{'ParameterKey':k,'ParameterValue':v} for k,v in params.items()],Capabilities=['CAPABILITY_IAM'],Tags=[{'Key':'Project','Value':'OddFrame'}])
        outputs=wait_stack(cfn,args.stack)
        for path in sorted((ROOT/'dist/client').rglob('*')):
            if not path.is_file():continue
            relative=path.relative_to(ROOT/'dist/client').as_posix()
            mime={'.rsc':'text/x-component','.vtt':'text/vtt','.js':'text/javascript'}.get(path.suffix) or mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
            cache='public,max-age=60' if path.suffix=='.html' else 'public,max-age=86400'
            s3.upload_file(str(path),outputs['ContentBucket'],relative,ExtraArgs={'ContentType':mime,'CacheControl':cache,'ServerSideEncryption':'AES256'})
        cf=session.client('cloudfront')
        cf.create_invalidation(DistributionId=outputs['DistributionId'],InvalidationBatch={'Paths':{'Quantity':1,'Items':['/*']},'CallerReference':secrets.token_hex(12)})
        deadline=time.time()+1200
        while time.time()<deadline:
            if cf.get_distribution(Id=outputs['DistributionId'])['Distribution']['Status']=='Deployed':break
            time.sleep(20)
        else: raise RuntimeError('CloudFront is still deploying. Check status before sharing the URL.')
        health=json.loads(urllib.request.urlopen(outputs['WebsiteURL']+'/api/health',timeout=20).read())
        if health.get('storage')!='DynamoDB':raise RuntimeError('Cloud health check did not confirm DynamoDB.')
        save('aws-deployment.json',{'deployedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'DEPLOYED','outputs':outputs,'health':health,'artifactSha256':digest})
        print('Deployed:',outputs['WebsiteURL'])
        print('Dashboard key saved privately in data/aws-deployment-secrets.json. Do not share or package it.')
        return 0
    except (ClientError,BotoCoreError,RuntimeError,OSError) as e:
        # Never dump request objects or NoEcho parameters.
        print('Deployment/check stopped:',str(e)[:350]);return 1

if __name__=='__main__':raise SystemExit(main())
