import yaml from 'js-yaml'
import type { IlographDocument } from './ilographTypes.js'

export function stringifyIlographYaml(doc: IlographDocument): string {
  return yaml.dump(doc, {
    noRefs: true,
    lineWidth: 120,
    sortKeys: false,
  })
}

