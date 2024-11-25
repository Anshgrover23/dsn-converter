import type { AnyCircuitElement } from "circuit-json"
import type { DsnPcb } from "lib/dsn-pcb/types"
import { applyToPoint } from "transformation-matrix"

export function convertPadstacksToSmtPads(
  pcb: DsnPcb,
  transform: any,
): AnyCircuitElement[] {
  const elements: AnyCircuitElement[] = []
  const { padstacks, images } = pcb.library

  images.forEach((image) => {
    const componentId = image.name
    const placementComponent = pcb.placement.components.find(
      (comp) => comp.name === componentId,
    )

    if (!placementComponent) {
      console.warn(`No placement component found for image: ${componentId}`)
      return
    }

    // Handle each placement for this component
    placementComponent.places.forEach((place) => {
      const { x: compX, y: compY, side } = place

      image.pins.forEach((pin) => {
        // Find the corresponding padstack
        const padstack = padstacks.find((p) => p.name === pin.padstack_name)

        if (!padstack) {
          console.warn(`No padstack found for pin: ${pin.padstack_name}`)
          return
        }

        // Find shape in padstack - try rectangle first, then polygon
        const rectShape = padstack.shapes.find(
          (shape) => shape.shapeType === "rect",
        )

        const polygonShape = padstack.shapes.find(
          (shape) => shape.shapeType === "polygon",
        )

        let width: number
        let height: number

        if (rectShape) {
          // Handle rectangle shape
          const [x1, y1, x2, y2] = rectShape.coordinates
          width = Math.abs(x2 - x1) / 1000 // Convert μm to mm
          height = Math.abs(y2 - y1) / 1000 // Convert μm to mm
        } else if (polygonShape) {
          // Handle polygon shape
          const coordinates = polygonShape.coordinates
          let minX = Infinity
          let maxX = -Infinity
          let minY = Infinity
          let maxY = -Infinity

          // Coordinates are in pairs (x,y), so iterate by 2
          for (let i = 0; i < coordinates.length; i += 2) {
            const x = coordinates[i]
            const y = coordinates[i + 1]

            minX = Math.min(minX, x)
            maxX = Math.max(maxX, x)
            minY = Math.min(minY, y)
            maxY = Math.max(maxY, y)
          }

          width = Math.abs(maxX - minX) / 1000
          height = Math.abs(maxY - minY) / 1000
        } else {
          console.warn(`No valid shape found for padstack: ${padstack.name}`)
          return
        }

        // Calculate position in circuit space using the transformation matrix
        const { x: circuitX, y: circuitY } = applyToPoint(transform, {
          x: compX + pin.x,
          y: compY + pin.y,
        })

        const pcbPad: AnyCircuitElement = {
          type: "pcb_smtpad",
          pcb_smtpad_id: `${pin.padstack_name}_${pin.pin_number}`,
          pcb_component_id: componentId,
          pcb_port_id: `${pin.padstack_name}_${pin.pin_number}`,
          shape: "rect",
          x: circuitX,
          y: circuitY,
          width,
          height,
          layer: side === "front" ? "top" : "bottom",
          port_hints: [pin.pin_number.toString()],
        }

        elements.push(pcbPad)
      })
    })
  })
  return elements
}