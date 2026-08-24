import { useAppStore } from '../store/useAppStore'
import type { StudyPlanChapter } from './types'

// Stable reference for "no plan yet" -- a `?? []` inline in the selector
// would allocate a new array every call and starve useSyncExternalStore.
export const EMPTY_PLAN: StudyPlanChapter[] = []

// The 22 useAppStore selectors that were duplicated byte-for-byte in
// StudyPlanPanel.tsx and MaterialPlanPanel.tsx (moved here unchanged).
// `planKey` is `subject.id` for the per-subject plan, `material:${id}` for
// the per-material one -- the two keys never collide, same map either way.
export function useStudyPlanState(planKey: string) {
  const rawPlan = useAppStore((s) => s.studyPlans[planKey] ?? EMPTY_PLAN)
  const setStudyPlan = useAppStore((s) => s.setStudyPlan)
  const removeStudyPlan = useAppStore((s) => s.removeStudyPlan)
  const addTask = useAppStore((s) => s.addTask)
  const updateTask = useAppStore((s) => s.updateTask)
  const toggleItem = useAppStore((s) => s.toggleStudyPlanItem)
  const addAsTask = useAppStore((s) => s.addStudyPlanItemAsTask)
  const playbook = useAppStore((s) => s.studyPlanPlaybook)
  const setPlaybook = useAppStore((s) => s.setStudyPlanPlaybook)
  const skills = useAppStore((s) => s.skills)
  const librarianEnabled = useAppStore((s) => s.librarianEnabled)
  const logSkillCall = useAppStore((s) => s.logSkillCall)
  const recordSkillOutcome = useAppStore((s) => s.recordSkillOutcome)
  const pendingCallEvent = useAppStore((s) => s.studyPlanCallEvents[planKey])
  const skillEvents = useAppStore((s) => s.skillEvents)
  const events = useAppStore((s) => s.events)
  const setStudyPlanCallEvent = useAppStore((s) => s.setStudyPlanCallEvent)
  const allChapters = useAppStore((s) => s.chapters)
  const summaries = useAppStore((s) => s.summaries)
  const addEvent = useAppStore((s) => s.addEvent)
  const updateEvent = useAppStore((s) => s.updateEvent)
  const reassignOverdue = useAppStore((s) => s.reassignOverdueStudyPlanItems)

  return {
    rawPlan,
    setStudyPlan,
    removeStudyPlan,
    addTask,
    updateTask,
    toggleItem,
    addAsTask,
    playbook,
    setPlaybook,
    skills,
    librarianEnabled,
    logSkillCall,
    recordSkillOutcome,
    pendingCallEvent,
    skillEvents,
    events,
    setStudyPlanCallEvent,
    allChapters,
    summaries,
    addEvent,
    updateEvent,
    reassignOverdue,
  }
}
