export interface TooltipVisibilityState {
  hovered: boolean
  keyboardFocused: boolean
  touchOpen: boolean
}

export const tooltipVisible = ({ hovered, keyboardFocused, touchOpen }: TooltipVisibilityState): boolean =>
  hovered || keyboardFocused || touchOpen
