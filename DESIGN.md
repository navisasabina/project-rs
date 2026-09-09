---
name: Neutral Modern
colors:
  surface: '#fcf9f7'
  surface-dim: '#dcd9d8'
  surface-bright: '#fcf9f7'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f1'
  surface-container: '#f0edec'
  surface-container-high: '#eae8e6'
  surface-container-highest: '#e4e2e0'
  on-surface: '#1b1c1b'
  on-surface-variant: '#444748'
  inverse-surface: '#303030'
  inverse-on-surface: '#f3f0ef'
  outline: '#747878'
  outline-variant: '#c4c7c8'
  surface-tint: '#5d5e5f'
  primary: '#5d5e5f'
  on-primary: '#ffffff'
  primary-container: '#ffffff'
  on-primary-container: '#757676'
  inverse-primary: '#c6c6c6'
  secondary: '#5e5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e3e2e2'
  on-secondary-container: '#646464'
  tertiary: '#5d5f5f'
  on-tertiary: '#ffffff'
  tertiary-container: '#ffffff'
  on-tertiary-container: '#747676'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e3e2e2'
  primary-fixed-dim: '#c6c6c6'
  on-primary-fixed: '#1a1c1c'
  on-primary-fixed-variant: '#454747'
  secondary-fixed: '#e3e2e2'
  secondary-fixed-dim: '#c7c6c6'
  on-secondary-fixed: '#1b1c1c'
  on-secondary-fixed-variant: '#464747'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c7'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#454747'
  background: '#fcf9f7'
  on-background: '#1b1c1b'
  surface-variant: '#e4e2e0'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
---

# Design System

## Brand & Style
The visual style is a clean, modern, and professional minimalist approach using the Inter font family. It relies on a neutral-centric palette with restrained use of muted grays and crisp whites to convey absolute clarity, reliability, and modern efficiency.

## Colors
The color system is built on an understated, sophisticated monochromatic and neutral foundation.
- **Primary Color (`#767777`)**: Used for primary actions, key interactive states, and focal points.
- **Secondary Color (`#777777`)**: Used for supporting elements, secondary buttons, and subtle visual hierarchy.
- **Tertiary Color (`#ffffff`)**: Provides crisp contrast and background highlights.
- **Neutral Color (`#787776`)**: Forms the structural backbone for text, borders, and surface tones.

## Typography
The typography uses the **Inter** typeface across all levels (headline, body, and label), ensuring consistent readability, a contemporary geometric aesthetic, and exceptional legibility across all digital form factors.

## Layout & Spacing
A balanced fluid grid system is employed, structured around a standard modular spacing scale. Spacing token level `2` provides a comfortable, breathable rhythm for UI components and container padding.

## Elevation & Depth
Elevation is primarily communicated through subtle tonal surface layering and low-contrast outlines rather than heavy drop shadows, preserving a flat, modern, and harmonious interface feel.

## Shapes
The roundedness level is set to `2` (Rounded). UI elements feature a moderate corner radius (0.5rem for standard elements, scaling up to 1rem for large containers), offering an approachable yet professional visual tone.

## Components
- **Buttons:** Styled with rounded corners (`rounded-2`), utilizing the primary neutral-gray tone for high-emphasis actions and subtle borders for secondary actions.
- **Inputs:** Clean text fields featuring neutral outlines and Inter typography.
- **Cards:** Flat containers with subtle surface contrast and rounded corners.
- **Chips & Lists:** Compact, structured for maximum scannability and minimal visual clutter.