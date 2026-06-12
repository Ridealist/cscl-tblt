export type ActivityType = 'free_conversation' | 'task_solution';
export type SessionPurpose = 'evaluation' | 'practice';

export function normalizeActivityType(value: unknown): ActivityType {
  return value === 'free_conversation' ? 'free_conversation' : 'task_solution';
}

export function normalizeSessionPurpose(
  value: unknown,
  activityType?: ActivityType
): SessionPurpose {
  if (value === 'evaluation' || activityType === 'free_conversation') return 'evaluation';
  return 'practice';
}

export function getActivityTypeLabel(activityType: ActivityType): string {
  return activityType === 'free_conversation' ? '자유 대화' : '과제 해결';
}

export function getSessionPurposeForActivity(activityType: ActivityType): SessionPurpose {
  return activityType === 'free_conversation' ? 'evaluation' : 'practice';
}

export function getActivityTypeForSessionPurpose(sessionPurpose: SessionPurpose): ActivityType {
  return sessionPurpose === 'evaluation' ? 'free_conversation' : 'task_solution';
}

export function getSessionPurposeLabel(sessionPurpose: SessionPurpose): string {
  return sessionPurpose === 'evaluation' ? 'Evaluation' : 'Practice';
}
