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
  function artefactBelongsToChildPackage(artefactPackageId: string, childPackageId: string): boolean {
    return artefactPackageId === childPackageId
      || artefactPackageId.startsWith(`${childPackageId}.`)
      || artefactPackageId.startsWith(`${childPackageId}/`)
  }

  function crossPackageExternalEndpointId(input: {
    side: 'left' | 'right'
    localId: string
    foreignId: string
    label: string
    wrapperName?: string
  }): string {
    return [
      '__ext',
      input.side,
      input.localId,
      input.foreignId,
      input.label,
      input.wrapperName ?? '',
    ].join(':')
  }

  const crossPackageBridgeRelations = computed((): readonly BridgeRelation[] => {
    if (!options.focused() && !options.crossPackagePreviewActive()) return []

    const innerPackages = options.innerPackages()
    const innerArtefacts = options.innerArtefacts()
    if (!innerPackages.length || !innerArtefacts.length) return []

    const localArtefactIds = new Set(innerArtefacts.map((a) => a.id))
    const childPackageIds = innerPackages.map((p) => p.id)
    const mapArtefactToChildPackage = (artefactId: string): string | null => {
      const pkgId = artefactPackageId(artefactId)
      if (!pkgId) return null
      for (const childId of childPackageIds) {
        if (artefactBelongsToChildPackage(pkgId, childId)) return childId
      }
      return null
    }

    const out: BridgeRelation[] = []
    const seen = new Set<string>()
    for (const rel of options.visibleCrossArtefactRelations()) {
      if (rel.label === 'imports' && childPackageIds.includes(rel.from) && childPackageIds.includes(rel.to)) {
        if (rel.from === rel.to) continue
        const key = `${rel.from}\u0001${rel.to}\u0001${rel.label}\u0001${rel.wrapperName ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ from: rel.from, to: rel.to, label: rel.label, ...(rel.wrapperName ? { wrapperName: rel.wrapperName } : {}) })
        continue
      }

      const fromLocal = localArtefactIds.has(rel.from)
      const toLocal = localArtefactIds.has(rel.to)

      // Case A: relation crosses packages *within* this root scope (both endpoints local).
      // We collapse it to a package → package bridge so the root view can show folder imports
      // even when individual artefacts are not rendered as rows.
      if (fromLocal && toLocal) {
        const fromPkg = mapArtefactToChildPackage(rel.from)
        const toPkg = mapArtefactToChildPackage(rel.to)
        if (!fromPkg || !toPkg) continue
        if (fromPkg === toPkg) continue
        const wrapperName = rel.wrapperName ?? ''
        const key = `${fromPkg}\u0001${toPkg}\u0001${rel.label}\u0001${wrapperName}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ from: fromPkg, to: toPkg, label: rel.label, ...(wrapperName ? { wrapperName } : {}) })
        continue
      }

      // Case B: relation truly crosses the boundary (one endpoint local, one foreign).
      if (fromLocal === toLocal) continue
      const localId = fromLocal ? rel.from : rel.to
      const foreignId = fromLocal ? rel.to : rel.from
      const childPackageId = mapArtefactToChildPackage(foreignId)
      if (!childPackageId) continue
      const from = fromLocal ? localId : childPackageId
      const to = fromLocal ? childPackageId : localId
      const key = `${from}\u0001${to}\u0001${rel.label}\u0001${rel.wrapperName ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      const wrapperName = rel.wrapperName ?? ''
      out.push({ from, to, label: rel.label, ...(wrapperName ? { wrapperName } : {}) })
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
      return childPackageIds.some((childId) => artefactBelongsToChildPackage(pkgId, childId))
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
      const externalId = crossPackageExternalEndpointId({
        side,
        localId,
        foreignId,
        label: rel.label,
        wrapperName: rel.wrapperName,
      })
      const key = `${externalId}\u0001${localId}\u0001${rel.label}\u0001${rel.wrapperName ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        externalId,
        externalLabel,
        foreignArtefactId: foreignId,
        foreignPackageId: foreignPkgId || foreignId,
        localId,
        side,
        label: rel.label,
        ...(rel.wrapperName ? { wrapperName: rel.wrapperName } : {}),
      })
    }
    return out
  })

  const crossPackageExternalEndpoints = computed(() => {
    const byId = new Map<string, { id: string; label: string; side: 'left' | 'right'; foreignPackageId: string }>()
    for (const rel of crossPackageBoundaryStubRelations.value) {
      if (!byId.has(rel.externalId)) {
        byId.set(rel.externalId, {
          id: rel.externalId,
          label: rel.externalLabel,
          side: rel.side,
          foreignPackageId: rel.foreignPackageId,
        })
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
    if (options.focused() && options.focusedInnerArtefactId()) return []
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
        out.push({ from: rel.from, to: childPortId, label: rel.label, wrapperName: rel.wrapperName, overlay: true })
        out.push({
          from: childPortId,
          to: rel.to,
          label: rel.label,
          wrapperName: rel.wrapperName,
          displayLabel: innerArtefactEdgeDisplayLabel(innerArtefactRelationStroke(rel.label).kind, rel.wrapperName),
          overlay: true,
        })
        continue
      }

      if (fromIsLocalArtefact && toIsChildPackage) {
        const childPortId = childPackagePortId(rel.to, 'left')
        out.push({
          from: rel.from,
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
