# Documentation Index

이 디렉터리는 운영 문서를 목적별로 분리한다. 현재 production 기준값은 `operations/production-environment.md`를 우선한다.

## Operations

지금 어떻게 운영/배포/확인하는가

- [Production Environment](operations/production-environment.md): 현재 production 인프라와 런타임 source of truth
- [Deployment Runbook](operations/deployment-runbook.md): 배포, 재시작, health check 절차
- [Capacity Plan](operations/capacity-plan.md): 평상시/실험일 인스턴스와 동시 세션 기준
- [Incident Checklist](operations/incident-checklist.md): 장애 확인 순서와 주요 로그

## Architecture

- [Deployment Diagram](architecture/deployment-diagram.md): production 배포 구성과 외부 서비스 관계

## Decisions

Architecture Decision Record | 왜 이런 구조와 기준을 선택했는가

- [ADR 0001](adr/0001-use-supabase-as-production-source-of-truth.md): Supabase를 production 설정 source of truth로 사용
- [ADR 0002](adr/0002-run-realtime-only-for-current-experiment.md): 현재 실험 운영을 Realtime 중심으로 운영
- [ADR 0003](adr/0003-use-single-agent-systemd-service.md): production agent를 단일 systemd 서비스로 운영

## Superseded Documents

- [Realtime Deployment Strategy](realtime-deployment-strategy.md): 2026년 7월 Realtime 실험 검토 문서. 현재값은 `operations/` 문서를 따른다.
- [Production Supabase Runbook](production-supabase-runbook.md): Supabase migration runbook. migration 완료 후 일반 배포 기준은 `operations/deployment-runbook.md`를 따른다.
- [Legacy Pipeline Production Guide](archive/2026-legacy-pipeline-production-guide.md): `pipeline` 구현 시절의 15세션 부하 분석과 과거 production 운영 기록.
