import yaml from 'js-yaml'
import type { IlographDocument } from './ilographTypes.js'

export function stringifyIlographYaml(doc: IlographDocument): string {
  return yaml.dump(doc as object, {
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  })
}
