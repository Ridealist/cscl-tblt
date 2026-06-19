> Status: migration/reference.
> Supabase migration 완료 후 일반 production 기준값은 [Production Environment](operations/production-environment.md), 일반 배포 절차는 [Deployment Runbook](operations/deployment-runbook.md)을 따른다.

# Production Supabase Runbook

이 문서는 이미 배포된 EC2 서버(`/opt/cscl-tblt`)에 Supabase를 붙일 때 필요한 최소 절차를 정리한다.
목표는 기존 로컬 state 파일을 보존하면서 Supabase를 production source of truth로 전환하는 것이다.

## Scope

이 runbook에서 다루는 것:

- Supabase project 생성과 key 확인
- production migration SQL 적용
- EC2 환경변수 반영
- 기존 `config.json`, `prompt_config.json` import
- 최초 admin 계정 bootstrap
- 배포 전후 확인과 최소 rollback

이 runbook에서 다루지 않는 것:

- `logs/*.json`의 대량 backfill 자동화
- Supabase schema downgrade 자동화
- local Supabase 개발 환경 상세 설정

## 1. Preflight

EC2에서 현재 runtime state를 먼저 보존한다.

```bash
cd /opt/cscl-tblt
BACKUP_DIR=/opt/cscl-tblt-backups/supabase-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

cp -a .env "$BACKUP_DIR/.env" 2>/dev/null || true
mkdir -p "$BACKUP_DIR/client"
cp -a client/.env.local "$BACKUP_DIR/client/.env.local" 2>/dev/null || true
cp -a config.json "$BACKUP_DIR/config.json" 2>/dev/null || true
cp -a prompt_config.json "$BACKUP_DIR/prompt_config.json" 2>/dev/null || true
cp -a logs "$BACKUP_DIR/logs" 2>/dev/null || true
```

현재 배포 ref도 기록한다.

```bash
git rev-parse HEAD
git status --short --branch
```

## 2. Create Supabase Project

Supabase dashboard에서 새 project를 만든다.

필요한 값은 Supabase dashboard의 project settings에서 확인한다.

- Project URL: `https://<project-ref>.supabase.co`
- Publishable key: browser-safe key
- Secret key: server-only key, RLS를 우회할 수 있으므로 절대 client bundle에 노출하지 않는다.

production에서는 secret key를 GitHub Actions secret에 넣지 않고 EC2 runtime env 파일에 둔다.

## 3. Apply Migrations

Supabase SQL editor 또는 연결된 Supabase CLI에서 아래 파일 순서대로 적용한다.

```text
supabase/migrations/20260611000000_foundation.sql
supabase/migrations/20260612000000_realtime_prompt_version_rpc.sql
supabase/migrations/20260612010000_conversation_logs.sql
supabase/migrations/20260612020000_allow_multiple_class_sessions_per_livekit_room.sql
supabase/migrations/20260612030000_student_login.sql
supabase/migrations/20260612040000_student_access_code_on_students.sql
supabase/migrations/20260612050000_add_student_roll_number.sql
supabase/migrations/20260612060000_fix_student_access_code_random.sql
supabase/migrations/20260612070000_session_purpose_and_activity.sql
```

적용 후 최소 확인 SQL:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles',
    'app_settings',
    'realtime_prompt_versions',
    'class_sessions',
    'conversation_events',
    'students'
  )
order by table_name;

select id, agent_mode, agent_role, feedback_condition_id, session_purpose
from public.app_settings
where id = 'default';
```

`app_settings.session_purpose`, `class_sessions.activity_type`, `students.access_code` 같은 최신 컬럼이 보여야 한다.

## 4. Configure EC2 Secrets

Next.js API routes는 `/opt/cscl-tblt/client/.env.local`을 읽는다.

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
SUPABASE_SECRET_KEY=<secret-key>
STUDENT_SESSION_SECRET=<long-random-server-only-secret>
CONVERSATION_LOG_FILE_FALLBACK=false
```

Python agent는 `/opt/cscl-tblt/.env`를 읽는다. 기존 LiveKit/OpenAI/S3 값은 유지하고 Supabase 값만 추가한다.

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=<secret-key>
```

`NEXT_PUBLIC_SUPABASE_URL`을 root `.env`에 둬도 agent는 읽을 수 있지만, agent 전용 파일에서는 `SUPABASE_URL`이 더 명확하다.

## 5. Import Existing config.json

기존 EC2 `config.json`은 Supabase 전환 후 runtime source가 아니다. 한 번 import한 뒤에는 `/admin`과 `app_settings`가 source of truth다.

예시 `config.json`:

```json
{
  "numClasses": 4,
  "numGroupsPerClass": 12,
  "classStart": 9,
  "activeClass": 9,
  "agentMode": "realtime",
  "agentRole": "collaborative",
  "feedbackConditionId": "explicit_correction",
  "sessionPurpose": "practice",
  "realtimeResetting": false
}
```

위 값을 Supabase SQL editor에서 `app_settings`로 seed한다.

```sql
insert into public.app_settings (
  id,
  num_classes,
  num_groups_per_class,
  class_start,
  active_class,
  agent_mode,
  agent_role,
  feedback_condition_id,
  session_purpose,
  realtime_resetting
)
values (
  'default',
  4,
  12,
  9,
  9,
  'realtime',
  'collaborative',
  'explicit_correction',
  'practice',
  false
)
on conflict (id) do update
set num_classes = excluded.num_classes,
    num_groups_per_class = excluded.num_groups_per_class,
    class_start = excluded.class_start,
    active_class = excluded.active_class,
    agent_mode = excluded.agent_mode,
    agent_role = excluded.agent_role,
    feedback_condition_id = excluded.feedback_condition_id,
    session_purpose = excluded.session_purpose,
    realtime_resetting = excluded.realtime_resetting;
```

확인:

```sql
select *
from public.app_settings
where id = 'default';
```

## 6. Import Existing prompt_config.json

`prompt_config.json` override가 없거나 Realtime custom prompt를 사용하지 않았다면 이 단계는 건너뛴다.

override가 있으면 `realtime_prompt_versions`에 active row를 하나 만든다. 기존 파일이 `basePrompt`, `dominantPrompt`, `collaborativePrompt`, `taskCardId`만 가지고 있으면 현재 tracked markdown에서 feedback prompt와 task card prompt를 확인해 함께 snapshot한다.

```sql
select public.activate_realtime_prompt_version(
  p_base_prompt := '<prompt_config.json realtime.basePrompt>',
  p_dominant_prompt := '<prompt_config.json realtime.dominantPrompt>',
  p_collaborative_prompt := '<prompt_config.json realtime.collaborativePrompt>',
  p_feedback_condition_id := '<resolved feedback condition id>',
  p_feedback_prompt := '<resolved feedback prompt>',
  p_task_card_id := '<resolved task card id>',
  p_task_card_prompt := '<resolved task card prompt>',
  p_created_by := '<admin auth user id>'
);
```

확인:

```sql
select id, feedback_condition_id, task_card_id, is_active, created_at
from public.realtime_prompt_versions
where is_active = true;
```

import 후 `prompt_config.json`은 보존용 파일일 뿐 runtime source가 아니다. Runtime Realtime prompt는 active Supabase row 또는 tracked markdown prompt를 사용한다.

## 7. Logs Policy

기존 `logs/*.json`은 삭제하지 않는다. 전환 직후에는 historical reference와 local fallback 자료로 보존한다.

현재 production dashboard는 Supabase `class_sessions`와 `conversation_events`를 source로 읽는다. 기존 JSON 로그를 Supabase로 backfill하는 자동 절차는 이 runbook 범위 밖이다.

새 세션은 Python agent가 기존 JSON file logging을 유지하면서 Supabase dual-write를 시도한다. Supabase write 실패는 agent session을 중단하지 않지만, production dashboard에는 해당 세션이 보이지 않을 수 있다.

## 8. Bootstrap First Admin

Supabase dashboard에서 Auth user를 email/password로 만든다. 생성된 user id를 복사한 뒤 SQL editor에서 admin role을 부여한다.

```sql
insert into public.profiles (user_id, role, display_name)
values ('<auth-user-id>', 'admin', 'Admin')
on conflict (user_id) do update
set role = 'admin',
    display_name = excluded.display_name;
```

확인:

```sql
select user_id, role, display_name
from public.profiles
where user_id = '<auth-user-id>';
```

브라우저에서 `https://tblt-agent.net/admin/login`에 접속해 로그인하고 `/admin` 접근을 확인한다.

## 9. Deploy And Verify

main 배포 또는 EC2 수동 배포를 실행한다.

```bash
cd /opt/cscl-tblt
./scripts/deploy-production.sh
```

배포 후 서버에서 확인한다.

```bash
curl -fsS http://localhost:3000/api/health
sudo systemctl is-active cscl-agent-pipeline
sudo systemctl is-active cscl-agent-realtime
pm2 describe cscl-client
```

브라우저 확인:

- `https://tblt-agent.net/admin/login` 로그인
- `/admin`에서 `app_settings` 값이 보이는지 확인
- `/admin`에서 Practice/Evaluation session purpose 변경이 저장되는지 확인
- `/admin/dashboard`가 열리는지 확인
- 학생 로그인 후 token 발급과 LiveKit 입장이 되는지 확인

수업 전 확인:

- `app_settings.active_class`
- `app_settings.agent_mode`
- `app_settings.session_purpose`
- `students` roster와 `access_code`
- active custom prompt가 의도한 값인지 여부

수업 후 확인:

- `/admin/dashboard`에 새 세션이 보이는지 확인
- Supabase `class_sessions`에 새 row가 생성됐는지 확인
- EC2 `logs/`에도 JSON 로그가 남는지 확인

## 10. Minimal Rollback

### App rollback

문제가 app 변경에서 발생했고 Supabase schema 자체는 유지해도 된다면 이전 git ref로 되돌려 배포한다.

```bash
cd /opt/cscl-tblt
git fetch origin main
git checkout main
git reset --hard <previous-good-commit>
./scripts/deploy-production.sh
```

### Runtime file rollback

env 또는 import 값이 문제라면 preflight backup에서 복원한다.

```bash
cp -a "$BACKUP_DIR/.env" /opt/cscl-tblt/.env
cp -a "$BACKUP_DIR/client/.env.local" /opt/cscl-tblt/client/.env.local
cp -a "$BACKUP_DIR/config.json" /opt/cscl-tblt/config.json 2>/dev/null || true
cp -a "$BACKUP_DIR/prompt_config.json" /opt/cscl-tblt/prompt_config.json 2>/dev/null || true

sudo systemctl restart cscl-agent-pipeline cscl-agent-realtime
pm2 restart cscl-client --update-env
```

### Supabase data rollback

운영 설정이 잘못됐으면 `app_settings`를 이전 값으로 update한다.

```sql
update public.app_settings
set agent_mode = 'pipeline',
    agent_role = 'dominant',
    feedback_condition_id = 'no_corrective',
    session_purpose = 'practice',
    realtime_resetting = false
where id = 'default';
```

active custom prompt가 잘못됐으면 `/admin`에서 기본값으로 복원하거나 SQL로 active row를 비활성화한다.

```sql
update public.realtime_prompt_versions
set is_active = false
where is_active = true;
```

### Schema rollback boundary

Production migration은 destructive rollback SQL 없이 즉시 되돌리지 않는다. Schema 문제가 의심되면 app rollback과 env rollback으로 서비스를 안정화한 뒤, 별도 SQL로 보정한다. `logs/*.json`은 보존되어 있으므로 새 대화의 원본 file log 확인이 가능하다.

## Deploy Script Policy

`scripts/deploy-production.sh`는 배포 중 다음 legacy state 파일을 백업 후 복원한다.

- `.env`
- `client/.env.local`
- `config.json`
- `prompt_config.json`

Supabase 전환 후에도 이 정책은 유지한다. 단, `config.json`과 `prompt_config.json`은 production source of truth가 아니라 fallback/import/reference 파일이다. Source of truth는 각각 Supabase `app_settings`와 `realtime_prompt_versions`다.
