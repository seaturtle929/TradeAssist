type ShortcutEvent = Pick<KeyboardEvent, 'key'|'code'|'altKey'|'ctrlKey'|'metaKey'|'shiftKey'|'repeat'|'isComposing'|'defaultPrevented'|'target'> & {composedPath?:()=>EventTarget[]};

/** The shortcut is deliberately inactive in editors, including shadow DOM editors. */
export function isSuggestNextMoveShortcut(event: ShortcutEvent): boolean {
  if(event.defaultPrevented||event.repeat||event.isComposing||!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||(event.code!=='Enter'&&event.key!=='Enter'))return false;
  const path=event.composedPath?.()||[event.target];
  return !path.some(target=>{
    const element=target as Element|null;
    return typeof element?.closest==='function'&&!!element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]');
  });
}
