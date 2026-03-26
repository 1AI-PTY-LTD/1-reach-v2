import { useEffect, useRef, useCallback } from "react"

const COLORS = ["#7400f6", "#190075", "#9d30a0", "#048fb5"]

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

interface Particle {
  x: number
  y: number
  size: number
  speedX: number
  speedY: number
  opacity: number
  type: number
  rotation: number
  rotationSpeed: number
  color: string
}

function createParticle(w: number, h: number): Particle {
  const typeRoll = Math.random()
  let type = 0
  if (typeRoll < 0.3) type = 0      // sms
  else if (typeRoll < 0.55) type = 1 // email
  else if (typeRoll < 0.75) type = 2 // mms
  else type = 3                       // dot

  return {
    x: Math.random() * w,
    y: Math.random() * h,
    size: 16 + Math.random() * 22,
    speedX: (Math.random() - 0.5) * 0.4,
    speedY: -0.25 - Math.random() * 0.4,
    opacity: 0.12 + Math.random() * 0.2,
    type,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.004,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }
}

function drawSMS(ctx: CanvasRenderingContext2D, p: Particle) {
  const { x, y, size, opacity, color } = p
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.fillStyle = color

  const w = size * 2.2
  const h = size * 1.4
  const r = size * 0.35

  ctx.beginPath()
  ctx.moveTo(x - w / 2 + r, y - h / 2)
  ctx.lineTo(x + w / 2 - r, y - h / 2)
  ctx.quadraticCurveTo(x + w / 2, y - h / 2, x + w / 2, y - h / 2 + r)
  ctx.lineTo(x + w / 2, y + h / 2 - r)
  ctx.quadraticCurveTo(x + w / 2, y + h / 2, x + w / 2 - r, y + h / 2)
  ctx.lineTo(x - w / 2 + r + size * 0.3, y + h / 2)
  ctx.lineTo(x - w / 2, y + h / 2 + size * 0.35)
  ctx.lineTo(x - w / 2 + r, y + h / 2)
  ctx.quadraticCurveTo(x - w / 2, y + h / 2, x - w / 2, y + h / 2 - r)
  ctx.lineTo(x - w / 2, y - h / 2 + r)
  ctx.quadraticCurveTo(x - w / 2, y - h / 2, x - w / 2 + r, y - h / 2)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = "rgba(255,255,255,0.6)"
  const lineY = y - h * 0.1
  ctx.fillRect(x - w * 0.28, lineY, w * 0.45, size * 0.09)
  ctx.fillRect(x - w * 0.28, lineY + size * 0.2, w * 0.3, size * 0.09)
  ctx.restore()
}

function drawEmail(ctx: CanvasRenderingContext2D, p: Particle) {
  const { x, y, size, opacity, color, rotation } = p
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.translate(x, y)
  ctx.rotate(rotation * 0.08)

  const w = size * 2
  const h = size * 1.4
  const r = size * 0.15

  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(-w / 2 + r, -h / 2)
  ctx.lineTo(w / 2 - r, -h / 2)
  ctx.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r)
  ctx.lineTo(w / 2, h / 2 - r)
  ctx.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2)
  ctx.lineTo(-w / 2 + r, h / 2)
  ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r)
  ctx.lineTo(-w / 2, -h / 2 + r)
  ctx.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = "rgba(255,255,255,0.45)"
  ctx.lineWidth = size * 0.07
  ctx.beginPath()
  ctx.moveTo(-w / 2 + size * 0.15, -h / 2 + size * 0.1)
  ctx.lineTo(0, size * 0.08)
  ctx.lineTo(w / 2 - size * 0.15, -h / 2 + size * 0.1)
  ctx.stroke()
  ctx.restore()
}

function drawMMS(ctx: CanvasRenderingContext2D, p: Particle) {
  const { x, y, size, opacity, color } = p
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.fillStyle = color

  const w = size * 1.6
  const h = size * 1.6
  const r = size * 0.25

  ctx.beginPath()
  ctx.moveTo(x - w / 2 + r, y - h / 2)
  ctx.lineTo(x + w / 2 - r, y - h / 2)
  ctx.quadraticCurveTo(x + w / 2, y - h / 2, x + w / 2, y - h / 2 + r)
  ctx.lineTo(x + w / 2, y + h / 2 - r)
  ctx.quadraticCurveTo(x + w / 2, y + h / 2, x + w / 2 - r, y + h / 2)
  ctx.lineTo(x - w / 2 + r, y + h / 2)
  ctx.quadraticCurveTo(x - w / 2, y + h / 2, x - w / 2, y + h / 2 - r)
  ctx.lineTo(x - w / 2, y - h / 2 + r)
  ctx.quadraticCurveTo(x - w / 2, y - h / 2, x - w / 2 + r, y - h / 2)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = "rgba(255,255,255,0.45)"
  ctx.beginPath()
  ctx.moveTo(x - w * 0.25, y + h * 0.18)
  ctx.lineTo(x - w * 0.05, y - h * 0.08)
  ctx.lineTo(x + w * 0.1, y + h * 0.05)
  ctx.lineTo(x + w * 0.2, y - h * 0.04)
  ctx.lineTo(x + w * 0.25, y + h * 0.18)
  ctx.closePath()
  ctx.fill()

  ctx.beginPath()
  ctx.arc(x + w * 0.16, y - h * 0.16, size * 0.13, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawDot(ctx: CanvasRenderingContext2D, p: Particle) {
  const { x, y, size, opacity, color } = p
  ctx.save()
  ctx.globalAlpha = opacity * 0.8

  const radius = size * 0.8
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
  gradient.addColorStop(0, color)
  gradient.addColorStop(1, hexToRgba(color, 0))
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

const drawFns = [drawSMS, drawEmail, drawMMS, drawDot]

export function AnimatedMessagesBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const animRef = useRef<number>(0)
  const sizeRef = useRef({ w: 0, h: 0 })

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    sizeRef.current = { w: rect.width, h: rect.height }

    const ctx = canvas.getContext("2d")
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    resize()
    window.addEventListener("resize", resize)

    const { w, h } = sizeRef.current
    particlesRef.current = Array.from({ length: 40 }, () => createParticle(w || 800, h || 600))

    function animate() {
      const cvs = canvasRef.current
      if (!cvs) return
      const ctx = cvs.getContext("2d")
      if (!ctx) return

      const { w: cw, h: ch } = sizeRef.current
      ctx.clearRect(0, 0, cw, ch)

      for (const p of particlesRef.current) {
        p.x += p.speedX
        p.y += p.speedY
        p.rotation += p.rotationSpeed

        if (p.y < -p.size * 3) {
          p.y = ch + p.size * 3
          p.x = Math.random() * cw
        }
        if (p.x < -p.size * 3) p.x = cw + p.size * 3
        if (p.x > cw + p.size * 3) p.x = -p.size * 3

        const fn = drawFns[p.type]
        if (fn) fn(ctx, p)
      }

      animRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener("resize", resize)
      cancelAnimationFrame(animRef.current)
    }
  }, [resize])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  )
}
