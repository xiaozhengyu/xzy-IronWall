import './hudButton.css';

export interface HudButtonOptions {
  /** Accessible button label and visible text. */
  label: string;
  /** Optional class for positioning or size variants at the call site. */
  className?: string;
  /** Native button type; defaults to button so it never submits a form by accident. */
  type?: 'button' | 'submit' | 'reset';
}

/**
 * Creates the reusable HUD nine-slice button. The frame is owned by CSS, so
 * callers can freely change width and height without rebuilding the element.
 */
export function createHudButton(options: HudButtonOptions): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = ['hud-button', options.className].filter(Boolean).join(' ');
  button.type = options.type ?? 'button';

  const label = document.createElement('span');
  label.className = 'hud-button-label';
  label.textContent = options.label;
  button.appendChild(label);

  return button;
}
