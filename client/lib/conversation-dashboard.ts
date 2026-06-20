import {
  type ActivityType,
  type SessionPurpose,
  getActivityTypeForSessionPurpose,
  getSessionPurposeForActivity,
} from '@/lib/session-activity';

export type DashboardFilterValue<T extends string> = 'all' | T;

export type DashboardFilters = {
  activityType: DashboardFilterValue<ActivityType>;
  evaluationId: string;
  search?: string;
  sessionPurpose: DashboardFilterValue<SessionPurpose>;
};

export type DashboardSessionMetadata = Record<string, unknown> & {
  activity_type?: unknown;
  agent_mode?: unknown;
  evaluation_id?: unknown;
  session_purpose?: unknown;
  student_class_number?: unknown;
  student_display_name?: unknown;
  student_name?: unknown;
  student_number?: unknown;
};

export type DashboardSessionLike = {
  id: string;
  metadata?: DashboardSessionMetadata;
  room: string;
  session_id: string;
};

export type DashboardSessionSection<T extends DashboardSessionLike> = {
  key: string;
  label: string;
  sessions: T[];
};

export type DashboardSessionGroup<T extends DashboardSessionLike> = {
  key: string;
  label: string;
  sections: Array<DashboardSessionSection<T>>;
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function textNumber(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value);
}

function parseRoomClass(room: string): string | undefined {
  const pipelineMatch = room.match(/^(\d+)반-/);
  if (pipelineMatch) return pipelineMatch[1];
  const realtimeMatch = room.match(/^(?:eval|task)[-_]([^-_]+)[-_]/);
  return realtimeMatch?.[1];
}

function parsePipelineRoom(room: string): { cls: string; grp: string } {
  const idx = room.lastIndexOf('-');
  return idx !== -1
    ? { cls: room.slice(0, idx), grp: room.slice(idx + 1) }
    : { cls: room, grp: '' };
}

function isRealtimeRoomName(room: string) {
  return (
    room.startsWith('realtime-') ||
    room.startsWith('eval-') ||
    room.startsWith('eval_') ||
    room.startsWith('task-') ||
    room.startsWith('task_')
  );
}

export function buildLogSessionsQuery(filters: DashboardFilters): string {
  const params = new URLSearchParams();
  if (filters.sessionPurpose !== 'all') params.set('sessionPurpose', filters.sessionPurpose);
  if (filters.activityType !== 'all') params.set('activityType', filters.activityType);
  if (filters.evaluationId.trim()) params.set('evaluationId', filters.evaluationId.trim());
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function inferDashboardSessionPurpose(
  session: Pick<DashboardSessionLike, 'metadata' | 'room'>
): SessionPurpose | undefined {
  const rawPurpose = session.metadata?.session_purpose;
  if (rawPurpose === 'evaluation' || rawPurpose === 'practice') return rawPurpose;
  const rawActivity = session.metadata?.activity_type;
  if (rawActivity === 'free_conversation' || rawActivity === 'task_solution') {
    return getSessionPurposeForActivity(rawActivity);
  }
  if (session.room.startsWith('eval-') || session.room.startsWith('eval_')) return 'evaluation';
  if (session.room.startsWith('task-') || session.room.startsWith('task_')) return 'practice';
  return undefined;
}

export function inferDashboardActivityType(
  session: Pick<DashboardSessionLike, 'metadata' | 'room'>
): ActivityType | undefined {
  const rawActivity = session.metadata?.activity_type;
  if (rawActivity === 'free_conversation' || rawActivity === 'task_solution') return rawActivity;
  const purpose = inferDashboardSessionPurpose(session);
  return purpose ? getActivityTypeForSessionPurpose(purpose) : undefined;
}

export function getDashboardStudentLabel(session: DashboardSessionLike): string {
  return (
    text(session.metadata?.student_display_name) ??
    text(session.metadata?.student_name) ??
    text(session.metadata?.student_number) ??
    session.room
  );
}

export function filterDashboardSessions<T extends DashboardSessionLike>(
  sessions: T[],
  search: string
): T[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((session) => {
    const metadata = session.metadata ?? {};
    return [
      session.id,
      session.room,
      session.session_id,
      text(metadata.student_display_name),
      text(metadata.student_name),
      text(metadata.student_number),
      text(metadata.evaluation_id),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });
}

export function groupDashboardSessions<T extends DashboardSessionLike>(
  sessions: T[]
): Array<DashboardSessionGroup<T>> {
  const groups = new Map<string, DashboardSessionGroup<T>>();

  for (const session of sessions) {
    const metadata = session.metadata ?? {};
    const purpose = inferDashboardSessionPurpose(session);
    const agentMode = text(metadata.agent_mode);
    const realtime =
      agentMode === 'realtime' || Boolean(purpose) || isRealtimeRoomName(session.room);
    const pipelineRoom = parsePipelineRoom(session.room);
    const groupKey = realtime ? `realtime:${purpose ?? 'unknown'}` : `pipeline:${pipelineRoom.cls}`;
    const groupLabel = realtime
      ? purpose === 'evaluation'
        ? 'Evaluation'
        : purpose === 'practice'
          ? 'Practice'
          : 'Realtime'
      : pipelineRoom.cls;
    const classNumber = textNumber(metadata.student_class_number) ?? parseRoomClass(session.room);
    const sectionLabel = realtime
      ? classNumber
        ? `${classNumber}반`
        : '반 미기록'
      : pipelineRoom.grp || '그룹 미기록';
    const sectionKey = realtime
      ? `${groupKey}:class:${classNumber ?? 'unknown'}`
      : `${groupKey}:group:${sectionLabel}`;

    const group = groups.get(groupKey) ?? { key: groupKey, label: groupLabel, sections: [] };
    let section = group.sections.find((candidate) => candidate.key === sectionKey);
    if (!section) {
      section = { key: sectionKey, label: sectionLabel, sessions: [] };
      group.sections.push(section);
    }
    section.sessions.push(session);
    groups.set(groupKey, group);
  }

  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko-KR'));
}
