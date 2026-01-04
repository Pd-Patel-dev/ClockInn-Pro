/**
 * Employee Color Utility
 * 
 * Generates consistent, distinct colors for each employee based on their ID.
 * Uses HSL color space for better color distribution and accessibility.
 */

interface EmployeeColorScheme {
  bg: string // Base background color (HSL)
  bgHover: string // Hover state background (HSL)
  bgSelected: string // Selected state background (HSL)
  bgConflict: string // Conflict state background (HSL)
  bgMuted: string // Draft/unpublished state background (HSL, lower opacity)
  border: string // Border color (HSL)
  text: string // Text color (black or white based on luminance)
  textMuted: string // Muted text color
}

// Cache for color calculations to avoid recalculation
const colorCache = new Map<string, EmployeeColorScheme>()

/**
 * Generate a simple hash from a string
 * This is used to deterministically map employee IDs to hue values
 */
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

/**
 * Calculate relative luminance of a color (RGB)
 * Returns value between 0 (dark) and 1 (light)
 * Used to determine if text should be black or white
 */
function getLuminance(r: number, g: number, b: number): number {
  // Convert RGB to relative luminance using sRGB formula
  const [rs, gs, bs] = [r, g, b].map(val => {
    val = val / 255
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/**
 * Convert HSL to RGB
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = h / 360
  s = s / 100
  l = l / 100

  let r: number, g: number, b: number

  if (s === 0) {
    r = g = b = l // achromatic
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1/6) return p + (q - p) * 6 * t
      if (t < 1/2) return q
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
      return p
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1/3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1/3)
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

/**
 * Convert RGB to HSL (helper for generating shades)
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }

  return [h * 360, s * 100, l * 100]
}

/**
 * Generate color scheme for an employee based on their ID
 * 
 * Algorithm:
 * 1. Hash employee_id to get a number
 * 2. Map hash to hue (0-359)
 * 3. Use consistent saturation (55-70%) and lightness (45-60%) for base
 * 4. Generate shades by varying lightness
 * 5. Determine text color based on luminance
 */
export function getEmployeeColor(employeeId: string): EmployeeColorScheme {
  // Check cache first
  if (colorCache.has(employeeId)) {
    return colorCache.get(employeeId)!
  }

  // Generate hash from employee ID
  const hash = hashString(employeeId)
  
  // Map hash to hue (0-359) - use golden ratio for better distribution
  // Focus on professional, muted color range (blues, grays, teals, soft greens)
  const goldenRatio = 0.618033988749895
  const rawHue = (hash * goldenRatio) % 360
  
  // Expanded color palette for better differentiation:
  // - Blues: 200-240
  // - Teals/Cyans: 170-200
  // - Greens: 100-140
  // - Yellows: 40-70
  // - Oranges: 20-40
  // - Purples: 250-290
  // - Pinks: 300-340
  const hueGroups = [
    { min: 200, max: 240 }, // Blues
    { min: 170, max: 200 }, // Teals/Cyans
    { min: 100, max: 140 }, // Greens
    { min: 40, max: 70 },   // Yellows
    { min: 20, max: 40 },   // Oranges
    { min: 250, max: 290 }, // Purples
    { min: 300, max: 340 }, // Pinks/Magentas
  ]
  const groupIndex = hash % hueGroups.length
  const selectedGroup = hueGroups[groupIndex]
  const hueRange = selectedGroup.max - selectedGroup.min
  const hueOffset = (hash * 13) % hueRange // Use different multiplier for better distribution
  const baseHue = selectedGroup.min + hueOffset
  
  // More vibrant but still professional color parameters
  // Increased saturation for better color distinction: 30-50%
  // Slightly darker backgrounds for better visibility: 75-88%
  const baseSaturation = 30 + (hash % 21) // 30-50%
  const baseLightness = 75 + (hash % 14) // 75-88%
  
  const baseSat = Math.round(baseSaturation)
  const baseLight = Math.round(baseLightness)
  
  // Convert to RGB to calculate luminance for text color
  const [r, g, b] = hslToRgb(baseHue, baseSat, baseLight)
  const luminance = getLuminance(r, g, b)
  
  // Choose text color based on background luminance
  // For lighter backgrounds (luminance > 0.5), use dark text
  // For darker backgrounds (luminance <= 0.5), use light text
  const textColor = luminance > 0.5 ? '#1f2937' : '#ffffff' // Dark gray or white
  const textMutedColor = luminance > 0.5 ? '#6b7280' : '#e5e7eb' // Medium gray or light gray
  
  // Generate shade variations with more contrast
  const hoverLightness = Math.max(70, Math.min(88, baseLight - 5)) // More noticeable hover
  const selectedLightness = Math.max(65, Math.min(88, baseLight - 8)) // More contrast for selected
  const conflictLightness = Math.max(72, Math.min(88, baseLight - 4)) // Noticeable conflict state
  const mutedLightness = Math.max(82, Math.min(95, baseLight + 5)) // Lighter for muted
  
  // Slightly increase saturation for hover/selected states
  const hoverSat = Math.min(60, baseSat + 5) // Slightly more vibrant on hover
  const selectedSat = Math.min(60, baseSat + 8) // More vibrant when selected
  
  // Generate vibrant, distinct color scheme
  const colorScheme: EmployeeColorScheme = {
    bg: `hsl(${baseHue}, ${baseSat}%, ${baseLight}%)`,
    bgHover: `hsl(${baseHue}, ${hoverSat}%, ${hoverLightness}%)`,
    bgSelected: `hsl(${baseHue}, ${selectedSat}%, ${selectedLightness}%)`,
    bgConflict: `hsl(${baseHue}, ${baseSat}%, ${conflictLightness}%)`,
    bgMuted: `hsl(${baseHue}, ${baseSat}%, ${mutedLightness}%)`,
    // More vibrant border that matches the increased saturation
    border: `hsl(${baseHue}, ${Math.min(65, baseSat + 10)}%, ${Math.max(60, baseLight - 15)}%)`,
    text: textColor,
    textMuted: textMutedColor,
  }
  
  // Cache the result
  colorCache.set(employeeId, colorScheme)
  
  return colorScheme
}

/**
 * Get CSS custom properties object for inline styling
 * Returns a Record type that can be used with inline styles
 */
export function getEmployeeColorStyles(employeeId: string, options?: {
  state?: 'normal' | 'hover' | 'selected' | 'conflict' | 'muted'
  opacity?: number
}): Record<string, string> {
  const colors = getEmployeeColor(employeeId)
  const state = options?.state || 'normal'
  const opacity = options?.opacity ?? 1
  
  let bgColor = colors.bg
  switch (state) {
    case 'hover':
      bgColor = colors.bgHover
      break
    case 'selected':
      bgColor = colors.bgSelected
      break
    case 'conflict':
      bgColor = colors.bgConflict
      break
    case 'muted':
      bgColor = colors.bgMuted
      break
  }
  
  // Apply opacity if specified (for muted/draft states)
  if (opacity < 1) {
    const hslMatch = bgColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/)
    if (hslMatch) {
      bgColor = `hsla(${hslMatch[1]}, ${hslMatch[2]}%, ${hslMatch[3]}%, ${opacity})`
    }
  }
  
  return {
    '--shift-bg': bgColor,
    '--shift-text': colors.text,
    '--shift-text-muted': colors.textMuted,
    '--shift-border': colors.border,
  }
}

