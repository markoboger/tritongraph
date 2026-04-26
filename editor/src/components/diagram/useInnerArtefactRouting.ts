import { computed } from 'vue'
import type {
  TritonInnerArtefactRelationSpec,
  TritonInnerArtefactSpec,
  TritonInnerPackageSpec,
} from '../../ilograph/types'
import {
  artefactPackageId,
  artefactSimpleName,
  childPackagePortId,
  innerArtefactEdgeDisplayLabel,
  innerArtefactRelationStroke,
  rootPackagePortId,
  type BoundaryStubRelation,
  type BridgeRelation,
  type PortEndpoint,
  type RoutedInnerRelation,
} from './innerArtefactGraphHelpers'

type RoutingOptions = {
  boxId: () => string
  focused: () => boolean
  innerDrillPath: () => readonly string[]
  innerPackages: () => readonly TritonInnerPackageSpec[]
  innerArtefacts: () => readonly TritonInnerArtefactSpec[]
  visibleCrossArtefactRelations: () => readonly TritonInnerArtefactRelationSpec[]
  crossPackagePreviewActive: () => boolean
  focusedInnerArtefactId: () => string | null | undefined
}

export function useInnerArtefactRouting(options: RoutingOptions) {
  const crossPackageBridgeRelations = computed((): readonly BridgeRelation[] => {
    if (options.innerDrillPath().length > 0) return []
    if (!options.focused() && !options.crossPackagePreviewActive()) return []

    const innerPackages = options.innerPackages()
    const innerArtefacts = options.innerArtefacts()
    if (!innerPackages.length || !innerArtefacts.length) return []

    const localArtefactIds = new Set(innerArtefacts.map((a) => a.id))
    const childPackageIds = innerPackages.map((p) => p.id)
    const mapForeignArtefactToChildPackage = (artefactId: string): string | null => {
      const pkgId = artefactPackageId(artefactId)
      if (!pkgId) return null
      for (const childId of childPackageIds) {
        if (pkgId === childId || pkgId.startsWith(`${childId}.`)) return childId
      }
      return null
    }

    const out: BridgeRelation[] = []
    const seen = new Set<string>()
    for (const rel of options.visibleCrossArtefactRelations()) {
      const fromLocal = localArtefactIds.has(rel.from)
      const toLocal = localArtefactIds.has(rel.to)
      if (fromLocal === toLocal) continue
      const localId = fromLocal ? rel.from : rel.to
      const foreignId = fromLocal ? rel.to : rel.from
      const childPackageId = mapForeignArtefactToChildPackage(foreignId)
      if (!childPackageId) continue
      const from = fromLocal ? localId : childPackageId
      const to = fromLocal ? childPackageId : localId
      const key = `${from}\u0001${to}\u0001${rel.label}\u0001${rel.wrapperName ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ from, to, label: rel.label, ...(rel.wrapperName ? { wrapperName: rel.wrapperName } : {}) })
    }
    return out
  })

  const crossPackageBoundaryStubRelations = computed((): readonly BoundaryStubRelation[] => {
    if (options.innerDrillPath().length > 0) return []
    if (!options.focused() && !options.crossPackagePreviewActive()) return []

    const innerArtefacts = options.innerArtefacts()
    if (!innerArtefacts.length) return []

    const localArtefactIds = new Set(innerArtefacts.map((a) => a.id))
    const focusedLocalId = options.focusedInnerArtefactId() ?? null
    const childPackageIds = options.innerPackages().map((p) => p.id)
    const foreignIsVisibleChildPackage = (artefactId: string): boolean => {
      const pkgId = artefactPackageId(artefactId)
      if (!pkgId) return false
      return childPackageIds.some((childId) => pkgId === childId || pkgId.startsWith(`${childId}.`))
    }

    const out: BoundaryStubRelation[] = []
    const seen = new Set<string>()
    for (const rel of options.visibleCrossArtefactRelations()) {
      const fromLocal = localArtefactIds.has(rel.from)
      const toLocal = localArtefactIds.has(rel.to)
      if (fromLocal === toLocal) continue
      const localId = fromLocal ? rel.from : rel.to
      const foreignId = fromLocal ? rel.to : rel.from
      if (foreignIsVisibleChildPackage(foreignId)) continue
      if (options.focused() && focusedLocalId && localId !== focusedLocalId) continue

      const side: 'left' | 'right' = toLocal ? 'left' : 'right'
      const foreignPkgId = artefactPackageId(foreignId)
      const externalLabel = focusedLocalId
        ? artefactSimpleName(foreignId)
        : (foreignPkgId.split('.').pop() || foreignPkgId || 'external')
      const externalId = focusedLocalId
        ? `__ext-${side}:art:${foreignId}`
        : `__ext-${side}:pkg:${foreignPkgId || foreignId}`
      const key = `${externalId}\u0001${localId}\u0001${rel.label}\u0001${rel.wrapperName ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        externalId,
        externalLabel,
        foreignArtefactId: foreignId,
        localId,
        side,
        label: rel.label,
        ...(rel.wrapperName ? { wrapperName: rel.wrapperName } : {}),
      })
    }
    return out
  })

  const crossPackageExternalEndpoints = computed(() => {
    const byId = new Map<string, { id: string; label: string; side: 'left' | 'right' }>()
    for (const rel of crossPackageBoundaryStubRelations.value) {
      if (!byId.has(rel.externalId)) {
        byId.set(rel.externalId, { id: rel.externalId, label: rel.externalLabel, side: rel.side })
      }
    }
    const all = [...byId.values()].sort((a, b) => a.label.localeCompare(b.label))
    return {
      left: all.filter((x) => x.side === 'left'),
      right: all.filter((x) => x.side === 'right'),
    }
  })

  const childPackagePorts = computed(() => {
    const out: PortEndpoint[] = []
    const seen = new Set<string>()
    for (const rel of crossPackageBridgeRelations.value) {
      const innerPackages = options.innerPackages()
      const innerArtefacts = options.innerArtefacts()
      const childPackageId = rel.from
      const localId = rel.to
      const childToLocal = innerPackages.some((pkg) => pkg.id === childPackageId)
        && innerArtefacts.some((art) => art.id === localId)
      if (childToLocal) {
        const id = childPackagePortId(childPackageId, 'right')
        if (!seen.has(id)) {
          seen.add(id)
          out.push({ id, side: 'right' })
        }
        continue
      }
      if (innerArtefacts.some((art) => art.id === rel.from) && innerPackages.some((pkg) => pkg.id === rel.to)) {
        const id = childPackagePortId(rel.to, 'left')
        if (!seen.has(id)) {
          seen.add(id)
          out.push({ id, side: 'left' })
        }
      }
    }
    return out
  })

  const childPackagePortsById = computed(() => {
    const out = new Map<string, PortEndpoint>()
    for (const port of childPackagePorts.value) out.set(port.id, port)
    return out
  })

  const rootPackagePorts = computed(() => {
    const out: PortEndpoint[] = []
    const innerPackages = options.innerPackages()
    const innerArtefacts = options.innerArtefacts()
    const needLeft = crossPackageBridgeRelations.value.some(
      (rel) => innerPackages.some((pkg) => pkg.id === rel.from) && innerArtefacts.some((art) => art.id === rel.to),
    )
    const needRight = crossPackageBridgeRelations.value.some(
      (rel) => innerArtefacts.some((art) => art.id === rel.from) && innerPackages.some((pkg) => pkg.id === rel.to),
    )
    if (needLeft) out.push({ id: rootPackagePortId(options.boxId(), 'left'), side: 'left' })
    if (needRight) out.push({ id: rootPackagePortId(options.boxId(), 'right'), side: 'right' })
    return out
  })

  const rootPackagePortsLeft = computed(() => rootPackagePorts.value.filter((p) => p.side === 'left'))
  const rootPackagePortsRight = computed(() => rootPackagePorts.value.filter((p) => p.side === 'right'))

  const routedCrossPackageBridgeRelations = computed((): readonly RoutedInnerRelation[] => {
    if (!options.focused()) {
      return crossPackageBridgeRelations.value.map((rel) => ({
        from: rel.from,
        to: rel.to,
        label: rel.label,
        wrapperName: rel.wrapperName,
        displayLabel: innerArtefactEdgeDisplayLabel(innerArtefactRelationStroke(rel.label).kind, rel.wrapperName),
        overlay: false,
      }))
    }
    const out: RoutedInnerRelation[] = []
    for (const rel of crossPackageBridgeRelations.value) {
      const innerPackages = options.innerPackages()
      const innerArtefacts = options.innerArtefacts()
      const fromIsChildPackage = innerPackages.some((pkg) => pkg.id === rel.from)
      const toIsChildPackage = innerPackages.some((pkg) => pkg.id === rel.to)
      const fromIsLocalArtefact = innerArtefacts.some((art) => art.id === rel.from)
      const toIsLocalArtefact = innerArtefacts.some((art) => art.id === rel.to)

      if (fromIsChildPackage && toIsLocalArtefact) {
        const childPortId = childPackagePortId(rel.from, 'right')
        const rootPortId = rootPackagePortId(options.boxId(), 'left')
        out.push({ from: rel.from, to: childPortId, label: rel.label, wrapperName: rel.wrapperName, overlay: true })
        out.push({
          from: childPortId,
          to: rootPortId,
          label: rel.label,
          wrapperName: rel.wrapperName,
          displayLabel: innerArtefactEdgeDisplayLabel(innerArtefactRelationStroke(rel.label).kind, rel.wrapperName),
          overlay: true,
        })
        out.push({ from: rootPortId, to: rel.to, label: rel.label, wrapperName: rel.wrapperName, overlay: true })
        continue
      }

      if (fromIsLocalArtefact && toIsChildPackage) {
        const rootPortId = rootPackagePortId(options.boxId(), 'right')
        const childPortId = childPackagePortId(rel.to, 'left')
        out.push({ from: rel.from, to: rootPortId, label: rel.label, wrapperName: rel.wrapperName, overlay: true })
        out.push({
          from: rootPortId,
          to: childPortId,
          label: rel.label,
          wrapperName: rel.wrapperName,
          displayLabel: innerArtefactEdgeDisplayLabel(innerArtefactRelationStroke(rel.label).kind, rel.wrapperName),
          overlay: true,
        })
        out.push({ from: childPortId, to: rel.to, label: rel.label, wrapperName: rel.wrapperName, overlay: true })
        continue
      }

      out.push({
        from: rel.from,
        to: rel.to,
        label: rel.label,
        wrapperName: rel.wrapperName,
        displayLabel: innerArtefactEdgeDisplayLabel(innerArtefactRelationStroke(rel.label).kind, rel.wrapperName),
        overlay: false,
      })
    }
    return out
  })

  return {
    crossPackageBridgeRelations,
    crossPackageBoundaryStubRelations,
    crossPackageExternalEndpoints,
    childPackagePortsById,
    rootPackagePortsLeft,
    rootPackagePortsRight,
    routedCrossPackageBridgeRelations,
  }
}
