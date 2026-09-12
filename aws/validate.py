import datetime, json, pathlib, subprocess, sys
root=pathlib.Path(__file__).resolve().parents[1]
result=subprocess.run([str(pathlib.Path(sys.executable).with_name('cfn-lint')),'-t','aws/template.json','aws/bootstrap.json'],cwd=root,text=True,capture_output=True)
record={'validatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'tool':'cfn-lint','exitCode':result.returncode,'status':'PASS' if result.returncode==0 else 'FAIL','output':result.stdout+result.stderr,'scope':'Local CloudFormation schema validation only; not AWS validation or deployment.'}
(root/'evidence/cloudformation-validation.json').write_text(json.dumps(record,indent=2)+'\n')
print(record['status']);print(record['output']);raise SystemExit(result.returncode)
