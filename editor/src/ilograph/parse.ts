import yaml from 'js-yaml'
import type { IlographDocument } from './types'

export function parseIlographYaml(text: string): IlographDocument {
  const doc = yaml.load(text) as unknown
  if (!doc || typeof doc !== 'object') {
    throw new Error('YAML root must be an object')
  }
  return doc as IlographDocument
}

export function stringifyIlographYaml(doc: IlographDocument | Record<string, unknown>): string {
  return yaml.dump(doc as object, {
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  })
}
