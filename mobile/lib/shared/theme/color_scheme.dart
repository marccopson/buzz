import 'package:flutter/material.dart';

import 'accent_colors.dart';

// MAC Workspace light
const lightColorScheme = ColorScheme(
  brightness: Brightness.light,
  primary: Color(0xFF2E387D),
  onPrimary: Color(0xFFFFFFFF),
  primaryContainer: Color(0xFF93AABB),
  onPrimaryContainer: Color(0xFF2D3445),
  secondary: Color(0xFFD37838),
  onSecondary: Color(0xFFFFFFFF),
  secondaryContainer: Color(0xFFF0D8C8),
  onSecondaryContainer: Color(0xFF2D3445),
  tertiary: Color(0xFF93AABB),
  onTertiary: Color(0xFFFFFFFF),
  tertiaryContainer: Color(0xFFDCE5EB),
  onTertiaryContainer: Color(0xFF2D3445),
  error: Color(0xFFC24837),
  onError: Color(0xFFFFFFFF),
  errorContainer: Color(0xFFF3D6D2),
  onErrorContainer: Color(0xFF8F2E22),
  surface: Color(0xFFFFFFFF),
  onSurface: Color(0xFF2D3445),
  onSurfaceVariant: Color(0xFF566070),
  outline: Color(0xFF93AABB),
  outlineVariant: Color(0xFFDCE5EB),
  inverseSurface: Color(0xFF2D3445),
  onInverseSurface: Color(0xFFF4F4F7),
  inversePrimary: Color(0xFF93AABB),
  shadow: Color(0xFF000000),
  scrim: Color(0xFF000000),
  surfaceTint: Color(0xFF2E387D),
  surfaceContainerHighest: Color(0xFFF4F4F7),
);

// MAC Workspace dark
const darkColorScheme = ColorScheme(
  brightness: Brightness.dark,
  primary: Color(0xFFD37838),
  onPrimary: Color(0xFF2D3445),
  primaryContainer: Color(0xFF2E387D),
  onPrimaryContainer: Color(0xFFF4F4F7),
  secondary: Color(0xFF93AABB),
  onSecondary: Color(0xFF2D3445),
  secondaryContainer: Color(0xFF3A4460),
  onSecondaryContainer: Color(0xFFF4F4F7),
  tertiary: Color(0xFF93AABB),
  onTertiary: Color(0xFF2D3445),
  tertiaryContainer: Color(0xFF3A4460),
  onTertiaryContainer: Color(0xFFF4F4F7),
  error: Color(0xFFE17B6D),
  onError: Color(0xFF2D3445),
  errorContainer: Color(0xFF642A22),
  onErrorContainer: Color(0xFFF4F4F7),
  surface: Color(0xFF2D3445),
  onSurface: Color(0xFFF4F4F7),
  onSurfaceVariant: Color(0xFFC5D0D8),
  outline: Color(0xFF708699),
  outlineVariant: Color(0xFF3A4460),
  inverseSurface: Color(0xFFF4F4F7),
  onInverseSurface: Color(0xFF2D3445),
  inversePrimary: Color(0xFF2E387D),
  shadow: Color(0xFF000000),
  scrim: Color(0xFF000000),
  surfaceTint: Color(0xFFD37838),
  surfaceContainerHighest: Color(0xFF252B3A),
);

/// Compute a contrast-safe foreground color for a given background.
/// Uses WCAG contrast ratio (higher ratio wins) instead of a simple luminance
/// cutoff, so colors like Blue (#3B82F6) correctly get black text (5.7:1)
/// rather than white (3.7:1).
Color contrastForeground(Color bg) {
  final lum = bg.computeLuminance();
  // WCAG contrast ratio: (L1 + 0.05) / (L2 + 0.05), L1 >= L2
  final contrastWithBlack = (lum + 0.05) / 0.05; // black luminance = 0
  final contrastWithWhite = 1.05 / (lum + 0.05); // white luminance = 1
  return contrastWithBlack >= contrastWithWhite
      ? const Color(0xFF000000)
      : const Color(0xFFFFFFFF);
}

/// Returns a [ColorScheme] with the given accent applied as primary.
ColorScheme applyAccent(ColorScheme base, int accentIndex) {
  if (accentIndex < 0 || accentIndex >= accentColors.length) {
    return base;
  }
  final color = accentColorForScheme(base, accentIndex);
  final onColor = contrastForeground(color);

  return base.copyWith(primary: color, onPrimary: onColor, surfaceTint: color);
}
