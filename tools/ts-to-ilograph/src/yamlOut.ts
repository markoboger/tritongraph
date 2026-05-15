import yaml from 'js-yaml'
import type { IlographDocument } from 'triton-core'

export function stringifyIlographYaml(doc: IlographDocument): string {
  return yaml.dump(doc, {
    noRefs: true,
    lineWidth: 120,
    sortKeys: false,
  })
}

