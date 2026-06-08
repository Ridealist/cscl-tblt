# Production infrastructure notes

This document records the Phase 1 infrastructure setup for issue #21. It is a
companion to `docs/production-start-stop.md`.

## Scope

Phase 1 uses scheduled/manual EC2 start-stop only. It keeps the existing
production stack unchanged and does not add a wake page, serverless migration,
container orchestration, or idle-aware stopping.

## Required EC2 tags

Add these tags to the production EC2 instance:

| Key | Value |
|---|---|
| `Project` | `cscl-tblt` |
| `Environment` | `production` |
| `AutoStop` | `true` |
| `Schedule` | `class-hours` |

These tags make it clear which instance is controlled by the scheduler and allow
IAM policies or automation to target only the production instance.

## Recommended scheduler

Use one AWS-native scheduler:

- AWS Systems Manager Resource Scheduler or Instance Scheduler when class times
  are regular.
- EventBridge Scheduler plus a small Lambda when class times vary by semester or
  need more explicit rule ownership.

For the first implementation, prefer the simplest AWS-native option that can
start and stop one tagged EC2 instance on a known class schedule.

Initial timing:

- Start 30 minutes before class.
- Stop 60 minutes after expected class end.
- Adjust after measuring actual boot-to-ready time.

## IAM permissions

The scheduler or Lambda role should be scoped to the production instance, not all
EC2 instances in the account.

Minimum EC2 actions:

```json
[
  "ec2:DescribeInstances",
  "ec2:StartInstances",
  "ec2:StopInstances"
]
```

If the automation supports tag conditions, require:

```json
{
  "ec2:ResourceTag/Project": "cscl-tblt",
  "ec2:ResourceTag/Environment": "production",
  "ec2:ResourceTag/AutoStop": "true"
}
```

## Manual AWS CLI commands

Set these values before using the commands:

```bash
export AWS_REGION=ap-northeast-2
export PROD_INSTANCE_ID=<instance-id>
```

Start:

```bash
aws ec2 start-instances \
  --region "$AWS_REGION" \
  --instance-ids "$PROD_INSTANCE_ID"

aws ec2 wait instance-status-ok \
  --region "$AWS_REGION" \
  --instance-ids "$PROD_INSTANCE_ID"
```

Stop:

```bash
aws ec2 stop-instances \
  --region "$AWS_REGION" \
  --instance-ids "$PROD_INSTANCE_ID"

aws ec2 wait instance-stopped \
  --region "$AWS_REGION" \
  --instance-ids "$PROD_INSTANCE_ID"
```

## Scheduler setup checklist

1. Confirm production instance ID and region.
2. Confirm Elastic IP is associated with the instance.
3. Add required EC2 tags.
4. Create the scheduler rule/association.
5. Attach the least-privilege role/policy.
6. Configure start time 30 minutes before class.
7. Configure stop time 60 minutes after class.
8. Add a CloudWatch log group or scheduler execution history view.
9. Run one dry-run outside class time.
10. Record measured boot-to-ready time in `docs/production-start-stop.md`.

## Rollback

To return to always-on operation:

1. Disable the scheduled stop rule or scheduler association.
2. Start the EC2 instance manually.
3. Confirm `./scripts/prod-health-check.sh` passes on the server.
4. Leave the instance running until scheduling is fixed.

Do not delete scheduler resources during an incident unless cleanup is required.
Disabling the rule is easier to audit and reverse.
