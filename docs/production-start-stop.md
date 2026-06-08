# Production EC2 start/stop runbook

This runbook covers Phase 1 of issue #21: reduce idle EC2 cost by starting the
production server only when it is needed for classes, experiments, admin setup,
QA, or debugging.

The Phase 1 approach keeps the current production architecture:

- AWS EC2 `m5.xlarge` on Ubuntu 22.04 LTS
- Route 53 plus Elastic IP for `tblt-agent.net`
- nginx plus Let's Encrypt SSL
- PM2 process `cscl-client`
- systemd agent services `cscl-agent-pipeline` and `cscl-agent-realtime`
- S3 for recordings
- LiveKit Cloud and OpenAI as external services

Phase 1 does not add request-driven wake-up, idle detection, or architecture
migration. Those belong to later phases.

## Operating rule

Keep EC2 running only during protected use windows:

- Start 30 minutes before a planned class or experiment.
- Keep running throughout the class, overrun, admin export, QA, or debugging.
- Stop 60 minutes after the expected end time, only after the stop checklist
  passes.

After boot-to-ready time has been measured several times, the start/stop buffer
can be tightened.

## Before regular stop/start

Verify these once before relying on scheduled stop/start:

- The instance uses EBS for important data, not instance store.
- Elastic IP stays associated with the instance after stop/start.
- Route 53 still points `tblt-agent.net` to the Elastic IP.
- `/opt/cscl-tblt/.env` persists.
- `/opt/cscl-tblt/client/.env.local` persists.
- `/opt/cscl-tblt/config.json` persists.
- `/opt/cscl-tblt/prompt_config.json`, if present, persists.
- nginx config and Let's Encrypt certificates persist.
- `pm2 save` has been run for `cscl-client`.
- PM2 startup is configured for reboot.
- `cscl-agent-pipeline` is enabled in systemd.
- `cscl-agent-realtime` is enabled in systemd.
- S3 recording upload flow is complete before shutdown.

Useful server-side checks:

```bash
lsblk
pm2 list
pm2 save
systemctl is-enabled cscl-agent-pipeline
systemctl is-enabled cscl-agent-realtime
sudo nginx -t
```

## Manual start

Use this for unscheduled QA/debugging, emergency startup, or before the scheduler
is fully configured.

1. Open the AWS EC2 console.
2. Select the production instance for `tblt-agent.net`.
3. Choose `Instance state` -> `Start instance`.
4. Wait until both EC2 status checks pass.
5. SSH into the instance.
6. Run the production health check:

```bash
cd /opt/cscl-tblt
./scripts/prod-health-check.sh
```

7. Open `https://tblt-agent.net`.
8. Open `https://tblt-agent.net/admin`.
9. Confirm the correct class/group/mode settings in admin.
10. Perform one test room join and confirm token issuance plus LiveKit
    connection.

AWS CLI equivalent:

```bash
aws ec2 start-instances --region ap-northeast-2 --instance-ids <instance-id>
aws ec2 wait instance-status-ok --region ap-northeast-2 --instance-ids <instance-id>
```

## Before class

1. Confirm the scheduled start time or manually start EC2 30 minutes before
   class.
2. Wait until EC2 status checks pass.
3. SSH into the instance.
4. Run:

```bash
cd /opt/cscl-tblt
./scripts/prod-health-check.sh
```

5. Verify `https://tblt-agent.net` loads.
6. Verify `https://tblt-agent.net/admin` loads.
7. Confirm class/group/mode settings in admin.
8. Perform one test room join.
9. Leave EC2 running until the post-class checklist is complete.

## During class

- Do not stop the EC2 instance manually.
- Do not enable a new scheduled stop inside the protected class window.
- Monitor LiveKit active rooms/participants if issues occur.
- Inspect `pm2 logs cscl-client` only when needed.
- Inspect `journalctl -u cscl-agent-pipeline` or
  `journalctl -u cscl-agent-realtime` only when needed.

## After class

1. Confirm students have left all LiveKit rooms.
2. Confirm recordings/egress jobs are complete.
3. Confirm no admin setup, QA, export, or debugging session is in progress.
4. SSH into the instance.
5. Run:

```bash
cd /opt/cscl-tblt
./scripts/prod-pre-stop-check.sh
```

6. Stop EC2 manually or let the scheduled stop run.
7. Confirm EC2 state becomes `stopped`.

AWS CLI equivalent:

```bash
aws ec2 stop-instances --region ap-northeast-2 --instance-ids <instance-id>
aws ec2 wait instance-stopped --region ap-northeast-2 --instance-ids <instance-id>
```

## Boot-to-ready measurement

Record each dry run here or in the issue before tightening schedule buffers.

| Date | Started at | EC2 checks passed | App healthy | Admin checked | Test room checked | Notes |
|---|---:|---:|---:|---:|---:|---|
| TBD | TBD | TBD | TBD | TBD | TBD | First dry run pending |

Recommended dry-run sequence:

1. Stop EC2 outside class time.
2. Start EC2.
3. Measure time until EC2 status checks pass.
4. Measure time until `./scripts/prod-health-check.sh` passes.
5. Verify admin and one test room.
6. Stop EC2 again after `./scripts/prod-pre-stop-check.sh` passes.

## Emergency rollback

If scheduled stop/start causes reliability issues:

1. Disable the scheduler association/rule.
2. Start EC2 manually.
3. Keep EC2 running always-on.
4. Verify app health with `./scripts/prod-health-check.sh`.
5. Review scheduler, CloudWatch, and system logs.
6. Re-enable scheduling only after the failure mode is understood.

## Phase 1 acceptance checklist

- Production EC2 has required scheduler tags.
- Manual start procedure is documented and tested.
- Manual stop procedure is documented and tested.
- Scheduler choice and IAM permissions are documented.
- `prod-health-check.sh` passes after start.
- `prod-pre-stop-check.sh` is used before stop.
- One dry-run stop/start cycle has been completed outside class time.
- Rollback to always-on operation is documented.
