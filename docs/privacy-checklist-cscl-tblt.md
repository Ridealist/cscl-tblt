# CSCL TBLT 개인정보처리방침 및 체크리스트 작성 자료

작성일: 2026-07-01

이 문서는 기존 PDF 2종(`개인정보처리방침`, `학습지원 소프트웨어 필수기준 체크리스트`)의 양식을 기준으로, 현재 `cscl-tblt` 프로젝트에서 확인되는 개인정보 처리 관련 내용을 추출한 작성용 초안이다. 최종 제출 전에는 공급자, 문의처, 대상 연령, 법정대리인 동의 방식, 보유 기간을 확정해야 한다.

## 1. 기존 PDF 양식에서 가져올 구조

- 문서 1: `개인정보 처리방침(공급자용)`
  - 제품/서비스 개요
  - 웹앱 게시 내용
  - 수집 항목
  - 수집·이용 목적
  - 보유·이용 기간
  - 안전성 확보 조치
  - 열람·정정·삭제·처리정지 절차
  - 만 14세 미만 아동 개인정보 보호
  - 개인정보 보호책임자
  - 제3자 제공
  - 위·수탁 관계
- 문서 2: `학습지원 소프트웨어 필수기준 체크리스트(공급자용)`
  - 제품/서비스 개요
  - 개인정보보호 기준 충족여부
  - 작성일 및 문의처

## 2. 프로젝트 기본 정보

| 항목 | 추출 내용 |
| --- | --- |
| 프로젝트명 | `cscl-tblt` |
| 서비스 표시명 후보 | `TBLT Agent`, `English Speaking Practice - CSCL TBLT`, `CSCL TBLT 영어 회화 실습 시스템` |
| 서비스 성격 | LiveKit 기반 AI 영어 대화 실습 시스템. TBLT(Task-Based Language Teaching) 방식으로 AI 캐릭터와 과업 기반 영어 대화를 수행한다. |
| 주요 대상 | 한국어권 영어 학습자. 프롬프트에는 `Korean 6th-grade EFL students`, `Grade 6 Korean elementary school student`가 명시되어 있어 만 14세 미만 학생 포함 가능성이 높다. |
| 운영 URL | `https://tblt-agent.net/` |
| 관리자 URL | `https://tblt-agent.net/admin/login`, `/admin`, `/admin/dashboard` |
| 현재 production 운영 모드 | `realtime` 개별 대화 모드 |
| 보존된 코드상 모드 | `pipeline` 그룹 대화 모드도 남아 있으나 현재 production 트래픽 경로는 아님 |
| 공급자 | 기존 PDF 기준 `김정민`으로 되어 있으나, 이 프로젝트 적용 여부 확인 필요 |
| 소속/문의처 | 기존 PDF 기준 `흥진고`, `yoriteacher@gmail.com`, `010-6620-2071`로 되어 있으나, 이 프로젝트 적용 여부 확인 필요 |

## 3. 기능 및 특징

- 학생은 학번, 이름, 개인 access code로 로그인한다.
- 로그인 성공 시 서버가 서명된 `student_session` HttpOnly 쿠키를 발급한다.
- 학생 세션 쿠키의 유효기간은 8시간이다.
- LiveKit 참가자 토큰은 `/api/token`에서 발급되며 TTL은 15분이다.
- 개별 대화 모드에서는 학생 1명당 LiveKit room 1개와 `realtime-agent` 1개가 생성된다.
- Practice 활동은 Kate와 영어 과제를 해결하는 TBLT 대화이다.
- Evaluation 활동은 Jack과 자유 대화를 하며 영어 상호작용 역량 관찰 데이터를 수집하는 구조이다.
- Practice task card 예시는 다음과 같다.
  - `L4. School Event Invitation`
  - `L5-T1. Our Class Morning Exercise Challenge`
  - `L5-T2. Our Class Healthy Habit Stamp Card`
  - `L5-T3. Our Class Special Activity Plan`
- 관리자는 `/admin`에서 운영 모드, 세션 목적, 에이전트 역할, 피드백 조건, 프롬프트 버전을 설정한다.
- 관리자는 `/admin/dashboard`에서 세션 목록과 대화 로그를 확인한다.
- 대화 텍스트 로그는 Supabase `class_sessions`, `conversation_events`에 저장된다.
- 파일 로그 fallback으로 EC2 `logs/*.json`에도 대화 로그가 저장된다.
- 세션 시작 시 LiveKit Egress가 모든 참가자(학생 + AI)의 혼합 음성을 MP3로 녹음해 S3에 저장한다.

## 4. 개인정보 처리 흐름

1. 학생이 웹앱에서 학번, 이름, access code를 입력한다.
2. 서버는 Supabase `students` 테이블의 활성 학생 row와 대조한다.
3. 인증 성공 시 서버가 학생 정보를 포함한 서명 쿠키를 발급한다.
4. 학생이 활동을 선택하면 `/api/token`이 LiveKit room 이름, 참가자 identity/name, 학생 메타데이터, 활동 메타데이터를 생성한다.
5. 브라우저는 LiveKit Cloud room에 WebRTC로 접속한다.
6. Python agent가 LiveKit room에 배치되어 OpenAI Realtime, Cartesia TTS 등을 사용해 대화를 진행한다.
7. 대화 중 학생 및 AI 발화 텍스트가 `ConversationLogger`를 통해 Supabase와 로컬 JSON에 기록된다.
8. 세션 음성은 LiveKit Egress를 통해 S3 MP3 파일로 저장된다.
9. 관리자는 Supabase Auth admin 권한으로 대시보드에서 세션과 대화 기록을 조회한다.

## 5. 수집·저장되는 항목

| 구분 | 항목 |
| --- | --- |
| 학생 roster | 학생 UUID, 학번, 이름, 영어 이름, 반 번호, 반 내 번호, 활성 여부, access code, metadata, 생성/수정 시각 |
| 학생 로그인 입력 | 학번, 이름, access code |
| 학생 세션 쿠키 | 학생 UUID, 학번, 이름, 영어 이름, 반 번호, 반 내 번호, 발급 시각, 만료 시각, HMAC 서명 |
| LiveKit 참가자 정보 | 참가자 identity(`student-{학번}-{랜덤값}`), 표시 이름, room 이름 |
| LiveKit/agent 메타데이터 | 학생 UUID, 학번, 이름, 표시 이름, 반 번호, 번호, agent mode, agent role, session purpose, activity type, prompt/version id, task card id, feedback condition id |
| 세션 기록 | LiveKit session id, room name, agent mode, agent role, session purpose, activity type, evaluation id, prompt id/version, egress id, recording path, 시작/종료 시각 |
| 대화 이벤트 | 순번, 역할(user/agent), 발화 텍스트, 참가자 identity, 참가자 이름, 학생 UUID, 학생 이름 스냅샷, 생성 시각, metadata |
| 음성 녹음 | 모든 참가자(학생 + AI)의 혼합 음성 MP3 파일 |
| 관리자 정보 | Supabase Auth 사용자, `profiles.role`, 표시명. 관리자 이메일/비밀번호는 Supabase Auth에서 처리 |
| 서버 로그 가능 항목 | `/api/token` 발급 로그에 room, 표시 이름, 학생 UUID, 학번, 활동/프롬프트 메타데이터가 남을 수 있음 |

## 6. 외부 서비스 및 위탁 후보

| 서비스 | 용도 | 처리 가능 정보 |
| --- | --- | --- |
| Supabase | Auth, DB, 운영 설정, 학생 roster, 대화 로그, 프롬프트 버전 저장 | 학생 식별정보, 세션/대화 텍스트, 관리자 계정 정보 |
| LiveKit Cloud | WebRTC room, token 기반 접속, agent dispatch, Egress 녹음 | 참가자 identity/name, 음성 스트림, room metadata |
| OpenAI | Realtime AI 대화 처리, 일부 pipeline LLM 처리 | 학생 발화 내용, 대화 맥락 |
| Cartesia | TTS 음성 합성 | AI 응답 텍스트 |
| AWS EC2 | 웹앱/agent 서버 실행 | 서버 로그, 로컬 JSON 대화 로그 |
| AWS S3 | Egress MP3 녹음 저장 | 음성 녹음 파일, recording path |
| Deepgram / LiveKit Inference | pipeline 모드 STT 처리. 현재 production 트래픽 기준은 아님 | pipeline 모드 사용 시 학생 음성 |

## 7. 보유·파기 관련 현재 상태

- Supabase `students`, `class_sessions`, `conversation_events`, `prompt_versions`에 대한 자동 보유기간/자동 파기 정책은 코드에서 확인되지 않았다.
- EC2 `logs/*.json` 파일은 자동 생성되며, production 전환 후에도 historical reference와 local fallback 자료로 보존한다는 문서가 있다.
- S3 녹음 파일은 `scripts/delete_s3_recordings.sh`로 날짜 기준 또는 LastModified 기준 삭제할 수 있다.
- S3 삭제 스크립트는 기본값이 dry run이고 `APPLY=true`를 주어야 실제 삭제한다.
- 최종 개인정보처리방침에는 `수집일로부터 1년`, `연구 종료 후 N개월`, `학기 종료 후 N개월` 등 실제 운영 정책을 반드시 확정해 기재해야 한다.

## 8. 안전성 확보 조치

- 운영 도메인은 `https://tblt-agent.net/`이며 HTTPS 경로를 사용한다.
- production source of truth는 Supabase `app_settings`다.
- Supabase RLS가 적용되어 있고 관리자 row는 `profiles.role = 'admin'`으로 구분한다.
- `/admin`, `/api/admin`, `/api/logs`, `/api/dispatch`, `/api/rooms/terminate` 등 관리자성 경로는 middleware와 `requireAdmin()`으로 보호된다.
- 관리자 로그인은 Supabase Auth session을 사용한다.
- Supabase secret key와 student session secret은 server-only 환경변수로 관리한다.
- 학생 세션 쿠키는 HttpOnly, SameSite=Lax, production Secure 설정을 사용한다.
- 학생 세션 쿠키는 HMAC 서명으로 변조 여부를 확인한다.
- `/api/token`은 학생 세션 쿠키가 없으면 LiveKit 토큰을 발급하지 않는다.
- LiveKit 토큰 TTL은 15분이다.
- 대화 로그 API 응답은 `Cache-Control: no-store`를 사용한다.
- production에서는 conversation log file fallback을 끌 수 있도록 `CONVERSATION_LOG_FILE_FALLBACK=false`를 사용한다.
- S3 녹음 삭제 스크립트는 실수 방지를 위해 dry run을 기본값으로 둔다.
- `.env`, `client/.env.local`, `logs/`는 git 추적 대상이 아니다.

## 9. 확인 필요 또는 보완 필요 항목

- 이 프로젝트의 공식 제품/서비스명을 확정해야 한다.
- 공급자, 소속, 개인정보 보호책임자, 전화, 이메일을 확정해야 한다.
- 실제 대상 연령을 확정해야 한다. 초등 6학년 대상이면 만 14세 미만 처리가 필요하다.
- 만 14세 미만 학생 대상일 경우 법정대리인 동의서, 학교/담임 안내, 동의 철회 절차 등 증빙이 필요하다.
- 음성 녹음 MP3 저장이 실제 필수인지 확인해야 한다. 기존 PDF 예시는 “음성 녹음 파일 미저장”이었지만 이 프로젝트는 저장한다.
- 보유·이용 기간과 파기 주기를 확정해야 한다.
- S3 bucket lifecycle rule을 적용할지 확인해야 한다.
- 학생 access code가 DB에 평문으로 저장되는 현재 구조가 정책상 허용되는지 검토해야 한다. 가능하면 hash 저장으로 변경하는 것이 안전하다.
- 기본 app config에는 카메라와 화면공유 컨트롤이 켜질 수 있다. 수업 목적상 불필요하면 비활성화하거나, 정책에 영상/화면공유 처리 가능성을 반영해야 한다.
- 대화 로그와 음성 녹음이 연구/평가 목적으로 사용되는 경우 연구 목적, 익명화/가명화, 접근권한, 분석 범위를 별도 고지해야 한다.

## 10. 개인정보 처리방침 초안

### 개인정보 처리방침(공급자용)

#### 제품/서비스 개요

| 항목 | 내용 |
| --- | --- |
| 제품/서비스명 | CSCL TBLT 영어 회화 실습 시스템 / TBLT Agent |
| 공급자 | [확인 필요: 기존 PDF 기준 김정민] |
| 접속경로 | https://tblt-agent.net/ |
| 관리자 경로 | https://tblt-agent.net/admin/login |

#### 주요 내용 및 기능·특장점

- AI 영어 회화 연습
  - 학생은 학번, 이름, access code로 로그인한 후 AI 친구와 영어 음성 대화를 수행한다.
  - 개별 대화 모드에서는 학생 1명과 AI agent 1명이 1:1로 대화한다.
  - Practice 활동에서는 Kate와 학교 행사, 건강 습관, 특별 활동 등 TBLT 과제를 해결한다.
  - Evaluation 활동에서는 Jack과 자유 대화를 하며 학생의 영어 상호작용 역량 관찰 자료를 수집한다.
- 실시간 대화 지원
  - LiveKit WebRTC room을 통해 실시간 음성 대화를 제공한다.
  - OpenAI Realtime과 Cartesia TTS를 사용해 AI 응답을 생성하고 음성으로 제공한다.
  - 대화 중 발화 내용은 텍스트 로그로 기록된다.
- 학습·평가 데이터 관리
  - Supabase에 학생 roster, 수업 운영 설정, 세션 기록, 대화 이벤트를 저장한다.
  - 관리자 대시보드에서 세션별 대화 기록과 활동 조건을 확인할 수 있다.
  - LiveKit Egress를 통해 학생과 AI의 혼합 음성 녹음 MP3가 S3에 저장된다.

#### 웹앱 게시 내용

이 앱은 영어 회화 학습, 과제 기반 영어 말하기 활동, 평가·연구 자료 확인을 위해 아래와 같이 필요한 개인정보를 처리합니다. 대상 학생에 만 14세 미만 아동이 포함될 수 있으므로, 해당되는 경우 법정대리인 동의 후 이용합니다.

#### 1. 수집 항목

- 학생 기본 정보: 학번, 이름, 영어 이름 또는 표시 이름, 반 번호, 번호
- 로그인 확인 정보: 학생별 access code, 로그인 세션 쿠키
- 대화 및 학습 활동 정보: 학생이 말하거나 입력한 내용, AI 응답 내용, 대화 시각, 대화 순서, 활동 유형, 과제/평가 ID, 프롬프트/피드백 조건
- 세션 정보: LiveKit room 이름, 참가자 identity/name, 세션 시작·종료 시각, agent mode/role
- 음성 녹음 파일: 학생과 AI의 대화 음성을 혼합한 MP3 파일
- 관리자 정보: 관리자 계정, 권한, 표시명

#### 2. 수집·이용 목적

- 학생 본인 확인 및 수업 참여 권한 확인
- AI 영어 회화 활동 제공
- 과제 기반 영어 말하기 활동 운영
- 학생 영어 상호작용 역량 관찰 및 평가·연구 자료 확인
- 교사/관리자의 세션 기록 확인 및 수업 운영
- 서비스 장애 확인, 보안, 품질 개선

#### 3. 보유·이용 기간

- 학생 roster: [확정 필요: 예: 학기 종료 후 또는 연구 종료 후 N개월]
- 대화 텍스트 로그: [확정 필요]
- 음성 녹음 파일: [확정 필요]
- 관리자 계정 정보: 관리자 권한 유지 기간 동안 보관
- 보유기간이 끝나거나 처리 목적이 달성되면 지체 없이 파기합니다.

#### 4. 개인정보 안전성 확보 조치

- HTTPS 접속 경로 사용
- Supabase Auth 기반 관리자 로그인 및 admin role 검증
- 관리자성 API와 대시보드 접근 제한
- Supabase RLS 정책 적용
- 학생 세션 쿠키의 HttpOnly, SameSite, Secure 설정 및 HMAC 서명
- LiveKit 참가자 토큰의 짧은 유효기간 적용
- 서버 전용 secret key의 브라우저 노출 방지
- 대화 로그 API의 no-store 캐시 정책
- S3 녹음 파일 삭제 스크립트 및 접근권한 관리

#### 5. 열람·정정·삭제·처리정지 절차

- 학생 또는 법정대리인은 본인 정보의 열람, 정정, 삭제, 처리정지를 개인정보 보호책임자에게 요청할 수 있습니다.
- 요청 접수 후 학생 roster, 대화 텍스트 로그, 음성 녹음 파일, 관련 세션 기록을 확인하여 필요한 조치를 수행합니다.
- 연락처: [확정 필요]

#### 6. 만 14세 미만 아동의 개인정보 보호

- 본 서비스는 초등학생 또는 만 14세 미만 학생이 이용할 수 있으므로, 해당되는 경우 법정대리인 동의를 받은 뒤 이용합니다.
- 법정대리인은 아동 개인정보의 열람, 정정, 삭제, 처리정지를 요청할 수 있습니다.
- 현재 코드에는 법정대리인 동의 화면이 내장되어 있지 않으므로, 별도 동의서 또는 학교 안내·동의 절차를 증빙으로 관리해야 합니다.

#### 7. 개인정보 보호책임자

- 성명: [확정 필요: 기존 PDF 기준 김정민]
- 연락처: [확정 필요: 기존 PDF 기준 yoriteacher@gmail.com / 010-6620-2071]
- 소속: [확정 필요: 기존 PDF 기준 흥진고]

#### 8. 제3자 제공

- 수집한 개인정보는 원칙적으로 제3자에게 제공하지 않습니다.
- 단, 법령에 근거가 있거나 정보주체 또는 법정대리인의 별도 동의가 있는 경우에는 예외로 합니다.

#### 9. 위·수탁 관계 및 외부 처리 서비스

서비스 제공을 위해 다음 외부 서비스를 이용합니다.

- Supabase: 학생 roster, 관리자 인증, 세션·대화 기록, 운영 설정 저장
- LiveKit Cloud: 실시간 음성 room, WebRTC 연결, agent dispatch, Egress 녹음
- OpenAI: AI 대화 처리
- Cartesia: AI 음성 합성
- AWS EC2/S3: 서버 운영 및 음성 녹음 파일 저장
- Deepgram 또는 LiveKit Inference: pipeline 모드 사용 시 STT 처리

## 11. 체크리스트 초안

### 학습지원 소프트웨어 필수기준 체크리스트(공급자용)

#### 제품/서비스 개요

| 항목 | 내용 |
| --- | --- |
| 제품/서비스명 | CSCL TBLT 영어 회화 실습 시스템 / TBLT Agent |
| 공급자 | [확인 필요] |
| 접속경로 | https://tblt-agent.net/ |
| 주요 내용 및 기능·특장점 | AI 영어 회화 실습, TBLT 과제 해결, 자유 대화 평가 자료 수집, Supabase 기반 대화 로그 관리, S3 음성 녹음 저장, 관리자 대시보드 |

#### 개인정보보호 기준 충족여부

| 선정기준 | 세부 내용 | 현재 판단 | 증빙 또는 근거 | 보완 필요 |
| --- | --- | --- | --- | --- |
| 1. 최소처리 원칙 준수 | 1-1. 개인정보가 최소한으로 수집되는가? | 부분 충족 | 학생 로그인과 세션 운영에 학번·이름·access code 사용. 대화 로그와 음성 녹음은 학습·평가 목적과 연결됨 | 카메라/화면공유 UI가 불필요하면 비활성화 필요. 음성 녹음 필수성 명시 필요 |
| 1. 최소처리 원칙 준수 | 1-2. 개인정보 수집·이용 목적이 기재되어 있는가? | 충족 가능 | 개인정보처리방침 제2조 초안 | 최종 게시 문구 확정 필요 |
| 1. 최소처리 원칙 준수 | 1-3. 개인정보 수집항목, 보유기간 등이 기재되어 있는가? | 보완 필요 | 개인정보처리방침 제1조, 제3조 초안 | 보유기간이 코드/문서상 확정되어 있지 않음 |
| 2. 개인정보 안전조치 의무 | 2-1. 개인정보 안전성 확보에 필요한 조치 사항이 기재되어 있는가? | 충족 가능 | HTTPS, Supabase Auth/RLS, admin guard, HttpOnly 서명 쿠키, LiveKit token TTL, server-only secret | S3 접근권한, lifecycle, access code 평문 저장 정책 확인 필요 |
| 3. 열람/정정/삭제/처리정지 절차 | 3-1. 이용자에게 자신의 정보를 열람·정정·삭제·처리정지 요구할 수 있는 절차가 안내되어 있는가? | 보완 필요 | 개인정보처리방침 제5조 초안 | 실제 접수 연락처와 처리 담당자 확정 필요 |
| 4. 만14세 미만 아동의 개인정보 보호 | 4-1. 만 14세 미만 아동의 경우 법정대리인 동의 등 보호 절차가 마련되어 있는가? | 보완 필요 | 프롬프트에 초등 6학년 대상 명시 | 코드 내 동의 화면 없음. 오프라인 동의서 또는 별도 인증/동의 절차 증빙 필요 |
| 5. 보호책임자/제3자제공/위탁 등 | 5-1. 개인정보 보호책임자 관련 정보가 안내되어 있는가? | 보완 필요 | 개인정보처리방침 제7조 초안 | 보호책임자, 전화, 메일, 소속 확정 필요 |
| 5. 보호책임자/제3자제공/위탁 등 | 5-2. 개인정보 제3자 제공에 관한 정보가 기재되어 있는가? | 충족 가능 | 개인정보처리방침 제8조 초안 | 제3자 제공 없음 원칙 확정 필요 |
| 5. 보호책임자/제3자제공/위탁 등 | 5-3. 개인정보 위·수탁관계에 관한 정보가 기재되어 있는가? | 충족 가능 | 개인정보처리방침 제9조 초안 | Supabase, LiveKit, OpenAI, Cartesia, AWS, 필요 시 Deepgram 포함 여부 확정 |

#### 작성일 및 문의처

| 항목 | 내용 |
| --- | --- |
| 작성일 | 2026.7.1. |
| 문의처 | [확정 필요: 전화 / 메일] |

## 12. 코드·문서 근거

| 근거 | 내용 |
| --- | --- |
| `README.md` | 서비스 설명, 운영 모드, Next.js API routes, 대화 로그, Egress 녹음, S3 삭제/다운로드 절차 |
| `docs/architecture/deployment-diagram.md` | production 구조, `tblt-agent.net`, Supabase, LiveKit, OpenAI, S3 |
| `docs/operations/production-environment.md` | production 도메인, EC2, LiveKit, OpenAI gpt-realtime, Supabase, S3 bucket |
| `supabase/README.md` | Supabase scope, student login flow, server-only secret, conversation log dual-write, admin dashboard log policy |
| `supabase/migrations/20260612030000_student_login.sql` | `students` table schema |
| `supabase/migrations/20260612040000_student_access_code_on_students.sql` | 학생별 access code 생성/저장 구조 |
| `supabase/migrations/20260612010000_conversation_logs.sql` | `class_sessions`, `conversation_events` schema |
| `supabase/migrations/20260612080000_conversation_event_students.sql` | 대화 이벤트의 `student_id`, `student_name` 저장 |
| `supabase/migrations/20260616000000_prompt_versions_unification.sql` | `prompt_versions` 통합 schema와 admin RLS |
| `client/lib/student-store.ts` | 학번·이름·access code 기반 학생 인증 |
| `client/lib/student-auth.ts` | 학생 세션 쿠키, 8시간 max age, HttpOnly/SameSite/Secure/HMAC 서명 |
| `client/app/api/token/route.ts` | LiveKit token 발급, 15분 TTL, 학생/활동 metadata 생성 |
| `client/middleware.ts` | 관리자 경로 보호 |
| `client/lib/supabase/admin-auth.ts` | Supabase Auth user와 admin role 검증 |
| `agent/main.py` | Realtime/Pipeline agent, OpenAI Realtime, Cartesia TTS, 대화 이벤트 로깅, Egress 시작 |
| `agent/logger.py` | Supabase `class_sessions`/`conversation_events` dual-write와 로컬 JSON 로그 |
| `agent/egress_recorder.py` | 모든 참가자 음성 혼합 MP3를 S3에 저장 |
| `scripts/delete_s3_recordings.sh` | S3 녹음 파일 날짜/LastModified 기준 삭제 |
| `prompts/evaluation/pretest_6_10.md` | Grade 6 학생 대상, 영어 상호작용 관찰 목적 |
| `prompts/realtime/base.md` | 한국 초등 6학년 EFL 학생 대상, TBLT activity 목적 |
