export interface HumandUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  employeeInternalId: string;
  deleted: boolean;
  profilePicture?: string;
  hiringDate?: string;
}

export interface TimeEntry {
  id: number;
  userId: number;
  type: 'START' | 'END';
  source: string;
  time: string;
  referenceDate: string;
  pairId?: string;
}

export interface DaySummary {
  id: number;
  employeeId: string;
  userId: number;
  referenceDate: string;
  weekday: string;
  isWorkday: boolean;
  hasSchedule: boolean;
  hours: {
    estimated: number;
    scheduled: number;
    timeOff: number;
    worked: number;
  };
  entries: TimeEntry[];
  holidays: { id: number; name: string }[];
  timeOffRequests: { id: number; name: string }[];
  incidences: string[];
  timeSlots: { startTime: string; endTime: string }[];
  categorizedHours: { category: { name: string }; hours: number }[];
}

export interface ProcessedRow {
  fecha: string;
  dia: string;
  colaborador: string;
  employeeId: string;
  userId: number;
  ent1: string | null;
  sal1: string | null;
  ent2: string | null;
  sal2: string | null;
  almuerzo: string | null;
  hrsTrab: string | null;
  metEnt1: string | null;
  metSal1: string | null;
  metEnt2: string | null;
  metSal2: string | null;
  feriado: string | null;
  licencia: string | null;
  incidencias: string[];
  hoursWorked: number;
  isWorkday: boolean;
  rawDate: string;
}
