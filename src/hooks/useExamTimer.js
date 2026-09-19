import { useEffect, useMemo, useState } from 'react'

function monotonicNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function makeBase(serverNow) {
  return {
    serverMs: serverNow ? new Date(serverNow).getTime() : Date.now(),
    monotonicMs: monotonicNow(),
  }
}

function secondsBetween(deadlineAt, base) {
  if (!deadlineAt) return null
  const deadline = new Date(deadlineAt).getTime()
  const elapsed = Math.max(0, monotonicNow() - base.monotonicMs)
  return Math.max(0, Math.ceil((deadline - (base.serverMs + elapsed)) / 1000))
}

export function formatExamTime(totalSeconds) {
  if (totalSeconds == null) return '--:--'
  const seconds = Math.max(0, Number(totalSeconds) || 0)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours > 0) return [hours, minutes, rest].map((value) => String(value).padStart(2, '0')).join(':')
  return [minutes, rest].map((value) => String(value).padStart(2, '0')).join(':')
}

export function useExamTimer({ deadlineAt, serverNow, enabled = true, onExpire } = {}) {
  const [base, setBase] = useState(() => makeBase(serverNow))
  const [remainingSeconds, setRemainingSeconds] = useState(() => secondsBetween(deadlineAt, makeBase(serverNow)))
  const [expireGeneration, setExpireGeneration] = useState(0)

  useEffect(() => {
    const nextBase = makeBase(serverNow)
    setBase(nextBase)
    setRemainingSeconds(secondsBetween(deadlineAt, nextBase))
    setExpireGeneration((value) => value + 1)
  }, [deadlineAt, serverNow])

  useEffect(() => {
    if (!enabled || !deadlineAt) return undefined
    const tick = () => setRemainingSeconds(secondsBetween(deadlineAt, base))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [deadlineAt, base, enabled])

  useEffect(() => {
    if (!enabled || remainingSeconds !== 0) return undefined
    const id = window.setTimeout(() => onExpire?.(), 0)
    return () => window.clearTimeout(id)
  // expireGeneration prevents a stale timeout callback after a server resync.
  }, [remainingSeconds, enabled, onExpire, expireGeneration])

  return useMemo(() => ({
    remainingSeconds,
    formatted: formatExamTime(remainingSeconds),
    warning: remainingSeconds != null && remainingSeconds <= 5 * 60,
    critical: remainingSeconds != null && remainingSeconds <= 60,
    expired: remainingSeconds === 0,
  }), [remainingSeconds])
}
