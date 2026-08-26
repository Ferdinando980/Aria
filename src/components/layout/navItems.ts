import { Sun, CalendarDays, Library, Sparkles, Layers, FileText, GraduationCap, Dumbbell, Trophy, Settings } from 'lucide-react'

export const navItems = [
  { to: '/', label: 'Oggi', icon: Sun, end: true },
  { to: '/calendario', label: 'Calendario', icon: CalendarDays, end: false },
  { to: '/materiali', label: 'Materiali', icon: Library, end: false },
  { to: '/aria', label: 'Aria', icon: Sparkles, end: false },
  { to: '/flashcard', label: 'Flashcard', icon: Layers, end: false },
  { to: '/riassunti', label: 'Riassunti', icon: FileText, end: false },
  { to: '/cheat-study', label: 'Cheat Study', icon: GraduationCap, end: false },
  { to: '/allenamento', label: 'Allenamento', icon: Dumbbell, end: false },
  { to: '/progressi', label: 'Progressi', icon: Trophy, end: false },
  { to: '/impostazioni', label: 'Impostazioni', icon: Settings, end: false },
] as const
