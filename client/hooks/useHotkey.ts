'use client'

import { useEffect, useRef } from 'react'

export type HotkeyCombo = {
  key: string
  /** Treat Meta (Mac) and Ctrl (Windows/Linux) as the modifier */
  metaOrCtrl?: boolean
  shift?: boolean
  alt?: boolean
  /** Require modifier keys to be absent when false and metaOrCtrl not set */
  modFree?: boolean
}

export type HotkeyBinding =
  | {
      type: 'combo'
      combo: HotkeyCombo
      handler: () => void
      allowInInput?: boolean
    }
  | {
      type: 'sequence'
      keys: string[]
      handler: () => void
      allowInInput?: boolean
      timeoutMs?: number
    }

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return el.closest('[data-hotkey-ignore="true"]') != null
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

function matchCombo(e: KeyboardEvent, combo: HotkeyCombo): boolean {
  const wantKey = normalizeKey(combo.key)
  const eventKey = normalizeKey(e.key)
  if (eventKey !== wantKey) return false

  if (combo.metaOrCtrl) {
    if (!e.metaKey && !e.ctrlKey) return false
  } else if (combo.modFree) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false
  }

  if (combo.shift === true && !e.shiftKey) return false
  if (combo.shift === false && e.shiftKey) return false
  if (combo.alt === true && !e.altKey) return false
  if (combo.alt === false && e.altKey) return false

  return true
}

export function useHotkey(bindings: HotkeyBinding[], enabled = true): void {
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings

  const sequenceRef = useRef<{ keys: string[]; at: number }>({ keys: [], at: 0 })

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      const inInput = isTypingTarget(e.target)
      const list = bindingsRef.current

      for (const binding of list) {
        if (inInput && !binding.allowInInput) continue

        if (binding.type === 'combo') {
          if (matchCombo(e, binding.combo)) {
            e.preventDefault()
            binding.handler()
            sequenceRef.current = { keys: [], at: 0 }
            return
          }
          continue
        }

        const timeoutMs = binding.timeoutMs ?? 800
        const now = Date.now()
        const seq = binding.keys.map(normalizeKey)
        const pressed = normalizeKey(e.key)

        if (now - sequenceRef.current.at > timeoutMs) {
          sequenceRef.current = { keys: [], at: now }
        }

        const expected = seq[sequenceRef.current.keys.length]
        if (pressed === expected) {
          const nextKeys = [...sequenceRef.current.keys, pressed]
          sequenceRef.current = { keys: nextKeys, at: now }
          if (nextKeys.length === seq.length) {
            e.preventDefault()
            binding.handler()
            sequenceRef.current = { keys: [], at: 0 }
            return
          }
        } else if (pressed === seq[0]) {
          sequenceRef.current = { keys: [pressed], at: now }
        } else {
          sequenceRef.current = { keys: [], at: now }
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
