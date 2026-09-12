# OddFrame — The Drowned Thirteenth Floor

A short interactive cosmic-horror video story. Your building has twelve floors. Tonight, the lift offers B13.

**AWS demo:** https://d2u3tekn65t9o6.cloudfront.net/

The AWS deployment completed on 12 September 2026. The separate Cloudflare preview has its own player records.

## Play

Enter a nickname, watch each scene, and choose your next action. Eleven video clips lead to three endings: Check-In, Surface and Nameless. The interface and story text support English, Chinese and Mongolian; recordings remain in English. Videos attempt playback with sound after interaction, with a manual fallback when the browser blocks autoplay.

The fictional protagonist is Alex Morgan, matching the recordings. The player nickname identifies a saved run, not the character in the video. Media is AI-generated and may contain visual inconsistencies. This is prerecorded, branching video-on-demand, not live broadcasting or real-time camera generation.

Routes: `/` (home), `/drowned/` (story), `/insights/` (protected team statistics). The old Mother story routes and APIs are disabled.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run build:aws
npm start
```

Open http://127.0.0.1:8787/. Local runs use SQLite in the ignored `data/` directory. For development, run `npm run api` and `npm run dev` in separate terminals.

```sh
npm test
npm run verify
```

Tests use isolated records. Browser playback and a physical iPhone test are separate from automated API tests.

## AWS architecture and deployment

- EC2: Node.js API on one `t3.micro` instance in Sydney.
- S3: private static files, current elevator media and a separate installation archive.
- DynamoDB: authoritative player sessions, choices, playback events, line state and endings; 30-day expiry.
- CloudFront: public HTTPS, page routing and byte-range video delivery from S3; uncached API forwarding to EC2.
- CloudWatch: application logs retained for seven days, EC2 CPU metrics and a CPU alarm.
- CloudFormation: reproducible templates in `aws/`. The main stack is `oddframe-drowned`.
- Systems Manager: instance administration without opening SSH to the internet.

`aws/deploy.py` performs read-only checks by default. Creating a deployment requires a separately completed, current, account-specific `aws/account-review.json` and explicit `--execute`. It refuses to overwrite an existing deployment. Do not rerun creation against the live stack or assume a different account is free to use.

To prepare a reviewed release, run `npm run verify`, `npm run build:aws`, then `python3 aws/release.py`. AWS deployment scripts require Python 3 and boto3, and AWS credentials supplied through the normal local/AWS session—not source code. `aws/smoke-test.py --exercise` verifies an existing deployment and deliberately creates three clearly labelled QA runs.

## Data, security and costs

Player records expire logically after 30 days; DynamoDB physical TTL deletion is asynchronous. Statistics require a private admin key. Sessions use random tokens; do not share them or paste them into issues.

Never commit `data/`, `.env*`, `evidence/`, account reviews, installation archives, AWS access credentials or admin keys. The GitHub export excludes local history, player databases, reports, private backups and retired video revisions.

CloudFront uses HTTPS for visitors. Its restricted connection to the EC2 origin currently uses HTTP, so this is an assessment-demo architecture, not a claim of end-to-end encrypted production hosting. EC2 access is restricted to CloudFront and an origin secret; its role is limited to this project's storage/logs plus Systems Manager.

Free-plan credits are finite. Public IPv4, compute, storage and other usage can consume credits. Budget emails are alerts, not a spending cap. Review billing and remove resources when the assessment no longer needs them.

## Source layout

| Folder | Purpose |
| --- | --- |
| `app/`, `components/`, `lib/` | Frontend, language support and playback behavior |
| `server/` | API, story rules, SQLite/DynamoDB and separate D1 adapter |
| `public/media/drowned/` | Current story manifest, videos, posters and captions |
| `aws/` | CloudFormation, release packaging and deployment validation |
| `tests/`, `scripts/` | Program verification and build helpers |
| `drizzle/`, `db/` | Separate Cloudflare/D1 preview schema |

Some internal modules and historical test helpers retain the previous prototype's naming. They do not expose its old pages in the released website.
