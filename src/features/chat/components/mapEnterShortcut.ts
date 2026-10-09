// CHAT-SHORTCUT-1: Enter from the map opens the chat (desktop).
//
// "From the map" is literal: the key must reach the window from the map canvas
// or from nowhere (the page body, e.g. after a panel closed). An Enter aimed at
// anything else — another input, a button, a dialog, the battle panel — is that
// control's own Enter and is left alone. A held key repeats; only the first
// press counts, so holding Enter can never open the chat and then send.

export function isMapEnter(event: KeyboardEvent, map: HTMLElement | null): boolean {
  if (event.key !== 'Enter' || event.repeat || event.isComposing || event.defaultPrevented) return false
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false
  const target = event.target
  return (map !== null && target === map) || target === document.body || target === document.documentElement
}
