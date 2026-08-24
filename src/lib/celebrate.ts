import confetti from 'canvas-confetti'

export function celebrate(intensity: 'small' | 'big' = 'small') {
  const colors = ['#6C5CE7', '#FDCB6E', '#55EFC4', '#74B9FF']
  if (intensity === 'small') {
    confetti({ particleCount: 40, spread: 55, startVelocity: 30, origin: { y: 0.75 }, colors, scalar: 0.85 })
    return
  }
  confetti({ particleCount: 90, spread: 75, startVelocity: 40, origin: { y: 0.65 }, colors })
  setTimeout(() => confetti({ particleCount: 60, spread: 100, origin: { y: 0.6 }, colors, scalar: 1.1 }), 180)
}
