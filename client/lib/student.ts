export interface StudentProfile {
  id: string;
  studentNumber: string;
  name: string;
  englishName?: string;
  classNumber: number;
  rollNumber: number;
}

export function studentDefaultDisplayName(student: StudentProfile) {
  return student.englishName?.trim() || student.name;
}
