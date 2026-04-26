import type { BoxCompartment } from '../../diagram/boxCompartments'

export function buildFocusedBoxCompartments(options: {
  description?: string
  notes?: string
  extraCompartments?: readonly BoxCompartment[]
}): readonly BoxCompartment[] {
  const out: BoxCompartment[] = []
  if ((options.description ?? '').trim()) {
    out.push({
      id: 'purpose',
      title: 'Purpose',
      rows: [{ value: String(options.description ?? '') }],
    })
  }
  if ((options.notes ?? '').trim()) {
    out.push({
      id: 'notes',
      title: 'Notes',
      rows: [{ value: String(options.notes ?? '') }],
    })
  }
  for (const compartment of options.extraCompartments ?? []) out.push(compartment)
  return out
}
