import type {
  AnyCircuitElement,
  PcbComponent,
  SourceComponentBase,
} from "circuit-json"
import { getComponentValue } from "lib/utils/get-component-value"
import { getFootprintName } from "lib/utils/get-footprint-name"
import { applyToPoint, scale } from "transformation-matrix"
import type { ComponentGroup, DsnPcb, Image, Padstack, Pin } from "../types"
import { getPadstackName } from "lib/utils/get-padstack-name"
import { createRectangularPadstack } from "lib/utils/create-padstack"

const transformMmToUm = scale(1000)

export function processComponentsAndPads(
  componentGroups: ComponentGroup[],
  circuitElements: AnyCircuitElement[],
  pcb: DsnPcb,
) {
  const processedPadstacks = new Set<string>()
  const componentsByFootprint = new Map<
    string,
    Array<{
      componentName: string
      coordinates: { x: number; y: number }
      rotation: number
      value: string
      sourceComponent: SourceComponentBase | undefined
    }>
  >()

  // First pass: Group components by footprint
  for (const group of componentGroups) {
    const { pcb_component_id, pcb_smtpads } = group
    if (pcb_smtpads.length === 0) continue

    const pcbComponent = circuitElements.find(
      (e) =>
        e.type === "pcb_component" && e.pcb_component_id === pcb_component_id,
    ) as PcbComponent
    const sourceComponent =
      pcbComponent &&
      (circuitElements.find(
        (e) =>
          e.type === "source_component" &&
          e.source_component_id === pcbComponent.source_component_id,
      ) as SourceComponentBase)

    const footprintName = getFootprintName(sourceComponent, pcbComponent)
    const componentName = sourceComponent?.name || "Unknown"
    const circuitSpaceCoordinates = applyToPoint(
      transformMmToUm,
      pcbComponent.center,
    )

    if (!componentsByFootprint.has(footprintName)) {
      componentsByFootprint.set(footprintName, [])
    }

    componentsByFootprint.get(footprintName)?.push({
      componentName,
      coordinates: circuitSpaceCoordinates,
      rotation: pcbComponent?.rotation || 0,
      value: getComponentValue(sourceComponent),
      sourceComponent,
    })
  }

  // Second pass: Process each footprint group
  for (const [footprintName, components] of componentsByFootprint) {
    // All are having the same footprint so getting the first one
    const firstComponent = components[0]
    const componentGroup = componentGroups.find((group) => {
      const pcbComponent = circuitElements.find(
        (e) =>
          e.type === "pcb_component" &&
          e.source_component_id ===
            firstComponent.sourceComponent?.source_component_id,
      ) as PcbComponent
      return (
        pcbComponent && group.pcb_component_id === pcbComponent.pcb_component_id
      )
    })

    if (!componentGroup) continue

    // Add padstacks for SMT pads
    for (const pad of componentGroup.pcb_smtpads) {
      if (pad.shape === "rect") {
        const padstackName = getPadstackName({
          shape: "rect",
          width: pad.width * 1000,
          height: pad.height * 1000,
        })
        if (!processedPadstacks.has(padstackName)) {
          const padWidthInUm = Math.round(pad.width * 1000)
          const padHeightInUm = Math.round(pad.height * 1000)
          const padstack = createRectangularPadstack(
            padstackName,
            padWidthInUm,
            padHeightInUm,
          )
          pcb.library.padstacks.push(padstack)
          processedPadstacks.add(padstackName)
        }
      }
    }

    // Add image once per footprint
    const image: Image = {
      name: footprintName,
      outlines: [],
      pins: componentGroup.pcb_smtpads
        .map((pad) => {
          const pcbComponent = circuitElements.find(
            (e) =>
              e.type === "pcb_component" &&
              e.source_component_id ===
                firstComponent.sourceComponent?.source_component_id,
          ) as PcbComponent
          if (pad.shape === "rect") {
            return {
              padstack_name: getPadstackName({
                shape: "rect",
                width: pad.width * 1000,
                height: pad.height * 1000,
              }),
              pin_number:
                pad.port_hints?.find((hint) => !Number.isNaN(Number(hint))) ||
                1,
              x: (pad.x - pcbComponent.center.x) * 1000,
              y: (pad.y - pcbComponent.center.y) * 1000,
            }
          }
        })
        .filter((pin): pin is Pin => pin !== undefined),
    }
    pcb.library.images.push(image)

    // Add component entry
    const componentEntry = {
      name: footprintName,
      places: components.map((component) => ({
        refdes: component.componentName,
        x: component.coordinates.x,
        y: component.coordinates.y,
        side: "front" as const,
        rotation: component.rotation % 90,
        PN: component.value,
      })),
    }
    pcb.placement.components.push(componentEntry)
  }
}
