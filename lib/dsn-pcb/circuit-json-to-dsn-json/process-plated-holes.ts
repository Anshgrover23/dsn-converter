import type {
  AnyCircuitElement,
  PcbComponent,
  SourceComponentBase,
} from "circuit-json"
import {
  createCircularPadstack,
  createOvalPadstack,
} from "lib/utils/create-padstack"
import { getFootprintName } from "lib/utils/get-footprint-name"
import { getPadstackName } from "lib/utils/get-padstack-name"
import type { ComponentGroup, DsnPcb, Pin } from "../types"
import { getComponentValue } from "lib/utils/get-component-value"
import { applyToPoint, scale } from "transformation-matrix"

const transformMmToUm = scale(1000)

export function processPlatedHoles(
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

  for (const group of componentGroups) {
    const { pcb_component_id, pcb_plated_holes, pcb_smtpads } = group
    if (pcb_plated_holes.length === 0) continue

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

    if (!pcbComponent) continue

    const footprintName = getFootprintName(sourceComponent, pcbComponent)
    const componentName = sourceComponent?.name || "Unknown"
    const circuitSpaceCoordinates = applyToPoint(
      transformMmToUm,
      pcbComponent.center,
    )

    // Add to componentsByFootprint map
    if (pcb_smtpads.length === 0) {
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

    // Process padstacks for plated holes
    for (const hole of pcb_plated_holes) {
      if (hole.shape === "circle") {
        const padstackName = getPadstackName({
          shape: "circle",
          holeDiameter: hole.hole_diameter * 1000,
          outerDiameter: hole.outer_diameter * 1000,
        })
        if (!processedPadstacks.has(padstackName)) {
          const padDiameterInUm = Math.round(hole.outer_diameter * 1000)
          pcb.library.padstacks.push(
            createCircularPadstack(
              padstackName,
              padDiameterInUm,
              padDiameterInUm,
            ),
          )
          processedPadstacks.add(padstackName)
        }
      } else if (hole.shape === "oval" || hole.shape === "pill") {
        const padstackName = getPadstackName({
          shape: hole.shape,
          width: hole.hole_width * 1000,
          height: hole.hole_height * 1000,
        })
        if (!processedPadstacks.has(padstackName)) {
          const padInnerWidthInUm = Math.round(hole.hole_width * 1000)
          const padInnerHeightInUm = Math.round(hole.hole_height * 1000)
          const padOuterWidthInUm = Math.round(hole.outer_width * 1000)
          const padOuterHeightInUm = Math.round(hole.outer_height * 1000)
          pcb.library.padstacks.push(
            createOvalPadstack(
              padstackName,
              padOuterWidthInUm,
              padOuterHeightInUm,
              padInnerWidthInUm,
              padInnerHeightInUm,
            ),
          )
          processedPadstacks.add(padstackName)
        }
      }
    }

    // Find existing image and add plated hole pins
    let existingImage = pcb.library.images.find(
      (img) => img.name === footprintName,
    )

    if (!existingImage) {
      existingImage = {
        name: footprintName,
        outlines: [],
        pins: [],
      }
      pcb.library.images.push(existingImage)
    }
    const platedHolePins = pcb_plated_holes
      .map((hole) => {
        if (hole.shape === "circle") {
          const pin = {
            padstack_name: getPadstackName({
              shape: "circle",
              holeDiameter: hole.hole_diameter * 1000,
              outerDiameter: hole.outer_diameter * 1000,
            }),
            pin_number:
              hole.port_hints?.find((hint) => !Number.isNaN(Number(hint))) || 1,
            x: (Number(hole.x.toFixed(3)) - pcbComponent.center.x) * 1000,
            y: (Number(hole.y.toFixed(3)) - pcbComponent.center.y) * 1000,
          }

          // Only return pin if it doesn't already exist in the image
          return !existingImage.pins.some(
            (existingPin) =>
              existingPin.x === pin.x &&
              existingPin.y === pin.y &&
              existingPin.padstack_name === pin.padstack_name,
          )
            ? pin
            : undefined
        } else if (hole.shape === "oval" || hole.shape === "pill") {
          const pin = {
            padstack_name: getPadstackName({
              shape: hole.shape,
              width: hole.hole_width * 1000,
              height: hole.hole_height * 1000,
            }),
            pin_number:
              hole.port_hints?.find((hint) => !Number.isNaN(Number(hint))) || 1,
            x: (Number(hole.x.toFixed(3)) - pcbComponent.center.x) * 1000,
            y: (Number(hole.y.toFixed(3)) - pcbComponent.center.y) * 1000,
          }

          // Only return pin if it doesn't already exist in the image
          return !existingImage.pins.some(
            (existingPin) =>
              existingPin.x === pin.x &&
              existingPin.y === pin.y &&
              existingPin.padstack_name === pin.padstack_name,
          )
            ? pin
            : undefined
        }
      })
      .filter((pin): pin is Pin => pin !== undefined)

    existingImage.pins.push(...platedHolePins)
    // }
  }

  // Add component placements for plated-hole-only components
  for (const [footprintName, components] of componentsByFootprint) {
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
