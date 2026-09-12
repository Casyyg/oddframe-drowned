import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import {pageHandler,mediaHandler,cloudFrontSource} from './edge-functions.mjs';
const R=x=>({Ref:x}),A=(x,y)=>({'Fn::GetAtt':[x,y]}),S=x=>({'Fn::Sub':x});
const resources={};const add=(name,type,props,extra={})=>resources[name]={Type:type,Properties:props,...extra};
const block={BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true};
const encrypted={ServerSideEncryptionConfiguration:[{ServerSideEncryptionByDefault:{SSEAlgorithm:'AES256'}}]};
add('Network','AWS::EC2::VPC',{CidrBlock:'10.61.0.0/16',EnableDnsHostnames:true,EnableDnsSupport:true,Tags:[{Key:'Name',Value:S('${AWS::StackName}-network')}]});
add('Gateway','AWS::EC2::InternetGateway',{});
add('GatewayAttachment','AWS::EC2::VPCGatewayAttachment',{VpcId:R('Network'),InternetGatewayId:R('Gateway')});
add('Subnet','AWS::EC2::Subnet',{VpcId:R('Network'),CidrBlock:'10.61.1.0/24',MapPublicIpOnLaunch:true});
add('Routes','AWS::EC2::RouteTable',{VpcId:R('Network')});
add('InternetRoute','AWS::EC2::Route',{RouteTableId:R('Routes'),DestinationCidrBlock:'0.0.0.0/0',GatewayId:R('Gateway')},{DependsOn:'GatewayAttachment'});
add('SubnetRoutes','AWS::EC2::SubnetRouteTableAssociation',{SubnetId:R('Subnet'),RouteTableId:R('Routes')});
add('OriginSecurity','AWS::EC2::SecurityGroup',{GroupDescription:'Only CloudFront may reach the OddFrame API; no SSH',VpcId:R('Network'),SecurityGroupIngress:[{IpProtocol:'tcp',FromPort:8787,ToPort:8787,SourcePrefixListId:R('CloudFrontPrefixListId')}],SecurityGroupEgress:[{IpProtocol:'-1',CidrIp:'0.0.0.0/0'}]});
add('Content','AWS::S3::Bucket',{PublicAccessBlockConfiguration:block,BucketEncryption:encrypted,OwnershipControls:{Rules:[{ObjectOwnership:'BucketOwnerEnforced'}]}},{DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain'});
add('Sessions','AWS::DynamoDB::Table',{AttributeDefinitions:[{AttributeName:'id',AttributeType:'S'}],KeySchema:[{AttributeName:'id',KeyType:'HASH'}],BillingMode:'PROVISIONED',ProvisionedThroughput:{ReadCapacityUnits:5,WriteCapacityUnits:5},SSESpecification:{SSEEnabled:true},TimeToLiveSpecification:{AttributeName:'expiresAt',Enabled:true},Tags:[{Key:'Project',Value:'OddFrame'}]},{DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain'});
add('AppLogs','AWS::Logs::LogGroup',{LogGroupName:S('/oddframe/${AWS::StackName}/api'),RetentionInDays:7});
add('BackendRole','AWS::IAM::Role',{AssumeRolePolicyDocument:{Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'ec2.amazonaws.com'},Action:'sts:AssumeRole'}]},ManagedPolicyArns:[S('arn:${AWS::Partition}:iam::aws:policy/AmazonSSMManagedInstanceCore')],Policies:[{PolicyName:'OddFrameStorageAndLogs',PolicyDocument:{Version:'2012-10-17',Statement:[
 {Effect:'Allow',Action:['dynamodb:GetItem','dynamodb:PutItem','dynamodb:Scan'],Resource:A('Sessions','Arn')},
 {Effect:'Allow',Action:['s3:GetObject'],Resource:S('arn:${AWS::Partition}:s3:::${ArtifactBucket}/${ArtifactKey}')},
 {Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents','logs:DescribeLogStreams'],Resource:A('AppLogs','Arn')}
 ]}}]});
add('BackendProfile','AWS::IAM::InstanceProfile',{Roles:[R('BackendRole')]});
const userdata=[
 '#!/bin/bash','set -euo pipefail','umask 077',
 'dnf install -y nodejs22 nodejs22-npm amazon-cloudwatch-agent aws-cfn-bootstrap',
 'useradd --system --create-home oddframe',
 'mkdir -p /opt/oddframe /var/log/oddframe',
 'aws s3 cp s3://${ArtifactBucket}/${ArtifactKey} /opt/oddframe/backend.tar.gz --region ${AWS::Region}',
 'tar -xzf /opt/oddframe/backend.tar.gz -C /opt/oddframe',
 'cd /opt/oddframe','npm-22 ci --omit=dev --ignore-scripts',
 'chown -R root:oddframe /opt/oddframe','chmod 750 /opt/oddframe','chmod -R g+rX /opt/oddframe',
 'cat > /etc/oddframe.env <<\'ENV\'','NODE_ENV=production','DB_DRIVER=dynamodb','AWS_REGION=${AWS::Region}','DYNAMODB_TABLE=${Sessions}','HOST=0.0.0.0','PORT=8787','ADMIN_TOKEN=${AdminToken}','ORIGIN_SECRET=${OriginSecret}','ENV',
 'cat > /etc/systemd/system/oddframe.service <<\'UNIT\'','[Unit]','Description=OddFrame story API','After=network-online.target','[Service]','User=oddframe','Group=oddframe','WorkingDirectory=/opt/oddframe','EnvironmentFile=/etc/oddframe.env','ExecStart=/usr/bin/node-22 server/index.mjs','Restart=on-failure','RestartSec=3','NoNewPrivileges=true','PrivateTmp=true','ProtectSystem=strict','ProtectHome=true','LogsDirectory=oddframe','StandardOutput=append:/var/log/oddframe/api.log','StandardError=append:/var/log/oddframe/api.log','[Install]','WantedBy=multi-user.target','UNIT',
 'cat > /opt/aws/amazon-cloudwatch-agent/etc/oddframe.json <<\'CONFIG\'',
 '{"logs":{"logs_collected":{"files":{"collect_list":[{"file_path":"/var/log/oddframe/api.log","log_group_name":"${AppLogs}","log_stream_name":"{instance_id}"}]}},"force_flush_interval":5}}','CONFIG',
 'systemctl daemon-reload','systemctl enable --now oddframe',
 '/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/oddframe.json',
 'for i in $(seq 1 30); do if curl --fail --silent -H "X-Origin-Secret: ${OriginSecret}" http://127.0.0.1:8787/api/health >/dev/null; then /opt/aws/bin/cfn-signal -e 0 --stack ${AWS::StackName} --resource Backend --region ${AWS::Region}; exit 0; fi; sleep 3; done',
 '/opt/aws/bin/cfn-signal -e 1 --stack ${AWS::StackName} --resource Backend --region ${AWS::Region}'
].join('\n');
add('Backend','AWS::EC2::Instance',{ImageId:R('ImageId'),InstanceType:R('InstanceType'),IamInstanceProfile:R('BackendProfile'),SubnetId:R('Subnet'),SecurityGroupIds:[R('OriginSecurity')],MetadataOptions:{HttpTokens:'required',HttpPutResponseHopLimit:1},CreditSpecification:{CPUCredits:'standard'},Monitoring:false,BlockDeviceMappings:[{DeviceName:'/dev/xvda',Ebs:{VolumeSize:8,VolumeType:'gp3',Encrypted:true,DeleteOnTermination:true}}],UserData:{'Fn::Base64':S(userdata)},Tags:[{Key:'Name',Value:S('${AWS::StackName}-api')} ]},{DependsOn:['InternetRoute','SubnetRoutes'],CreationPolicy:{ResourceSignal:{Timeout:'PT15M',Count:1}}});
add('CpuAlarm','AWS::CloudWatch::Alarm',{AlarmDescription:'Sustained API CPU pressure; inspect before scaling',Namespace:'AWS/EC2',MetricName:'CPUUtilization',Dimensions:[{Name:'InstanceId',Value:R('Backend')}],Statistic:'Average',Period:300,EvaluationPeriods:2,Threshold:80,ComparisonOperator:'GreaterThanThreshold',TreatMissingData:'notBreaching'});
add('OAC','AWS::CloudFront::OriginAccessControl',{OriginAccessControlConfig:{Name:S('${AWS::StackName}-oac'),OriginAccessControlOriginType:'s3',SigningBehavior:'always',SigningProtocol:'sigv4'}});
add('RoutesFunction','AWS::CloudFront::Function',{Name:S('${AWS::StackName}-routes'),AutoPublish:true,FunctionConfig:{Comment:'Elevator pages and retired route protection',Runtime:'cloudfront-js-2.0'},FunctionCode:cloudFrontSource(pageHandler)});
add('MediaFunction','AWS::CloudFront::Function',{Name:S('${AWS::StackName}-media'),AutoPublish:true,FunctionConfig:{Comment:'Map player video URLs to private S3 objects',Runtime:'cloudfront-js-2.0'},FunctionCode:cloudFrontSource(mediaHandler)});
add('Distribution','AWS::CloudFront::Distribution',{DistributionConfig:{Enabled:true,Comment:'OddFrame assessment prototype',DefaultRootObject:'index.html',PriceClass:'PriceClass_100',HttpVersion:'http2',IPV6Enabled:true,ViewerCertificate:{CloudFrontDefaultCertificate:true},Origins:[
 {Id:'content',DomainName:A('Content','RegionalDomainName'),S3OriginConfig:{OriginAccessIdentity:''},OriginAccessControlId:R('OAC')},
 {Id:'api',DomainName:A('Backend','PublicDnsName'),CustomOriginConfig:{HTTPPort:8787,OriginProtocolPolicy:'http-only'},OriginCustomHeaders:[{HeaderName:'X-Origin-Secret',HeaderValue:R('OriginSecret')}]}
 ],DefaultCacheBehavior:{TargetOriginId:'content',ViewerProtocolPolicy:'redirect-to-https',AllowedMethods:['GET','HEAD','OPTIONS'],CachedMethods:['GET','HEAD'],Compress:true,CachePolicyId:'658327ea-f89d-4fab-a63d-7e88639e58f6',FunctionAssociations:[{EventType:'viewer-request',FunctionARN:A('RoutesFunction','FunctionARN')}]},CacheBehaviors:[
 {PathPattern:'/api/media/drowned/*',TargetOriginId:'content',ViewerProtocolPolicy:'redirect-to-https',AllowedMethods:['GET','HEAD','OPTIONS'],CachedMethods:['GET','HEAD'],Compress:false,CachePolicyId:'658327ea-f89d-4fab-a63d-7e88639e58f6',FunctionAssociations:[{EventType:'viewer-request',FunctionARN:A('MediaFunction','FunctionARN')}]},
 {PathPattern:'/api/*',TargetOriginId:'api',ViewerProtocolPolicy:'https-only',AllowedMethods:['GET','HEAD','OPTIONS','PUT','POST','PATCH','DELETE'],CachedMethods:['GET','HEAD'],Compress:true,CachePolicyId:'4135ea2d-6df8-44a3-9df3-4b5a84be39ad',OriginRequestPolicyId:'216adef6-5c7f-47e4-b989-5492eafa07d3'}]}});
add('ContentPolicy','AWS::S3::BucketPolicy',{Bucket:R('Content'),PolicyDocument:{Version:'2012-10-17',Statement:[{Sid:'OnlyThisCloudFrontDistribution',Effect:'Allow',Principal:{Service:'cloudfront.amazonaws.com'},Action:'s3:GetObject',Resource:S('${Content.Arn}/*'),Condition:{StringEquals:{'AWS:SourceArn':S('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}')}}},{Sid:'DenyPlainHttp',Effect:'Deny',Principal:'*',Action:'s3:*',Resource:[A('Content','Arn'),S('${Content.Arn}/*')],Condition:{Bool:{'aws:SecureTransport':'false'}}}]}});
const parameters={ArtifactBucket:{Type:'String'},ArtifactKey:{Type:'String',Default:'backend.tar.gz'},CloudFrontPrefixListId:{Type:'String',AllowedPattern:'pl-[a-f0-9]+'},InstanceType:{Type:'String',Default:'t3.micro',AllowedValues:['t2.micro','t3.micro']},ImageId:{Type:'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>',Default:'/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64'},AdminToken:{Type:'String',NoEcho:true,MinLength:32,MaxLength:128,AllowedPattern:'[a-f0-9]+'},OriginSecret:{Type:'String',NoEcho:true,MinLength:32,MaxLength:128,AllowedPattern:'[a-f0-9]+'}};
const template={AWSTemplateFormatVersion:'2010-09-09',Description:'OddFrame: EC2 API, private S3 media, CloudFront, DynamoDB, CloudWatch. Review account eligibility before deployment.',Parameters:parameters,Resources:resources,Outputs:{WebsiteURL:{Value:S('https://${Distribution.DomainName}')},ContentBucket:{Value:R('Content')},DistributionId:{Value:R('Distribution')},InstanceId:{Value:R('Backend')},SessionsTable:{Value:R('Sessions')},LogGroup:{Value:R('AppLogs')}}};
mkdirSync('aws',{recursive:true});writeFileSync('aws/template.json',JSON.stringify(template,null,2)+'\n');
const bootstrap={AWSTemplateFormatVersion:'2010-09-09',Description:'Private deployment-artifact bucket for OddFrame',Resources:{Artifacts:{Type:'AWS::S3::Bucket',DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain',Properties:{PublicAccessBlockConfiguration:block,BucketEncryption:encrypted,LifecycleConfiguration:{Rules:[{Id:'expire-builds',Status:'Enabled',ExpirationInDays:30}]}}}},Outputs:{ArtifactBucket:{Value:R('Artifacts')}}};writeFileSync('aws/bootstrap.json',JSON.stringify(bootstrap,null,2)+'\n');
const pkg=JSON.parse(readFileSync('package.json'));const lock=JSON.parse(readFileSync('package-lock.json'));
mkdirSync('aws/runtime',{recursive:true});writeFileSync('aws/runtime/package.json',JSON.stringify({name:'oddframe-api',version:'1.0.0',private:true,type:'module',engines:{node:'>=22.13.0'},dependencies:Object.fromEntries(['@aws-sdk/client-dynamodb','@aws-sdk/lib-dynamodb'].map(k=>[k,lock.packages['node_modules/'+k].version]))},null,2)+'\n');
console.log('CloudFormation templates generated. No resources deployed.');
