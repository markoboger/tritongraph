export interface BoxCompartmentRow {
  label?: string
  value: string
}

export interface BoxCompartment {
  id: string
  title: string
  rows: readonly BoxCompartmentRow[]
  emptyText?: string
}
