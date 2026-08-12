# 3D Transaction Space Design

## Overview

Transform the transaction widget into a 3D interactive space where cards float at different depths and camera movement creates immersive focus transitions.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Rendering approach | HTML cards inside 3D (React Three Fiber + Html) |
| Card layout | Floating at different Z depths |
| Focus behavior | Camera dolly + tilt toward focused card |
| Blur effect | Post-processing depth-of-field |
| Return animation | Smooth reverse to default position |

## Technology Stack

**New dependencies:**
- `@react-three/fiber` - React renderer for Three.js
- `@react-three/drei` - Helpers (Html, PerspectiveCamera, Float)
- `@react-three/postprocessing` - Depth-of-field effect
- `@react-spring/three` - Camera animation

## Architecture

### Scene Structure

```
<Canvas>
  <PerspectiveCamera />           // Animated camera
  <EffectComposer>
    <DepthOfField />              // Blur based on focal distance
  </EffectComposer>

  <group>                         // Card container
    <TokenCard3D />               // Multiple token cards at varying Z
    <ActionCard3D />              // Action zones at varying Z
  </group>
</Canvas>

<InputOverlay />                  // 2D input stays outside canvas
```

### Card Components

**Simplified cards for 3D** - stripped of Framer Motion animations:
- No CSS blur/opacity/scale transforms
- No motion wrappers
- Drag-and-drop functionality preserved
- 3D system handles all spatial effects

Existing `TransactionWidget` animations would conflict with:
- DOF blur (double blur with CSS filter)
- Camera dolly (conflicting with CSS scale)
- Animation timing (Framer springs vs Three.js)

### Layout

```
Default camera at [0, 0, 8] looking at origin

Left side (Tokens):        Right side (Actions):
  x: -3 to -1                x: 1 to 3
  z: -2 to 0                 z: 0.5 to 2.5

Cards have slight Y variation to avoid overlap
```

Focal plane at z=0. Tokens slightly in front, actions slightly behind - both have mild natural blur in default view.

### Camera Animation

**Default state:**
- Position: `[0, 0, 8]`
- Rotation: `[0, 0, 0]`
- Focus distance: `0`

**Focused state (when card selected):**
- Position: moves toward focused card (e.g., `[2, 0.5, 5]` for right-side card)
- Rotation: ~10° X tilt (look down), ~5° Z roll
- Focus distance: matches focused card's Z
- Duration: 600-800ms, easeOut

**Return:** Smooth reverse, same duration

## File Structure

```
src/app/space/
  page.tsx                    // Entry point (exists)

src/components/space-3d/
  Scene.tsx                   // Canvas + camera + effects + cards
  TokenCard3D.tsx             // 3D positioned token card
  ActionCard3D.tsx            // 3D positioned action zone
  useCamera.ts                // Camera animation state/controls
  useFocus.ts                 // Focus state management
  cards/
    SimpleTokenCard.tsx       // Presentational token card (no motion)
    SimpleDropZone.tsx        // Presentational drop zone (no motion)
```

## Implementation Steps

1. Install dependencies
2. Create simplified card components (no Framer Motion)
3. Build Scene with static card positions
4. Add camera animation on focus
5. Add depth-of-field post-processing
6. Wire up drag-and-drop
7. Tune positions and timing

## Open Questions (To Resolve During Implementation)

- Exact Z depth values for optimal DOF blur
- Camera tilt angles that feel natural
- Whether to add subtle Float animation for idle state
- Mobile/touch interaction handling
