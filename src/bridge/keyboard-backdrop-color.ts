export interface KeyboardBackdropColor {
  red: number
  green: number
  blue: number
}

/** Convert the app-core theme's `--z-bg` channels into a native-safe color. */
export function parseThemeBackdropColor(value: string): KeyboardBackdropColor | null {
  const channels = value.trim().split(/\s+/).map(Number)
  if (
    channels.length !== 3 ||
    channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)
  ) {
    return null
  }

  return {
    red: channels[0]!,
    green: channels[1]!,
    blue: channels[2]!
  }
}
